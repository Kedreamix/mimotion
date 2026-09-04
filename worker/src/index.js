import { clientKey, createLimiter } from "./rate-limit.js";
import { exchangeGithubCode, githubAuthorizeUrl, oauthConfigured, pagesRedirectUri } from "./oauth.js";
import { safeEqual } from "./secret.js";
import { guestSync, maskUser, normalizeUser } from "./zepp.js";
import { hydrateStats, publicStats, recordGuest } from "./stats.js";

async function triggerWorkflowDispatch({ repo, pat, workflowId = "run.yml", inputs = {}, fetchImpl = fetch }) {
  const [owner, repoName] = repo.split("/");
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "master", inputs }),
    },
  );
  if (res.status === 204) return { ok: true };
  let msg = `GitHub API ${res.status}`;
  try {
    const body = await res.json();
    if (body.message) msg = body.message;
  } catch { /* ignore */ }
  throw new Error(msg);
}

const limiterStore = new Map();
const limiter = createLimiter(limiterStore, { limit: 8, windowMs: 10 * 60 * 1000 });

const DEFAULT_PAGES_ORIGIN = "https://kedreamix.github.io/mimotion";

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_PAGES_ORIGIN)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function originKey(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;
  const key = originKey(origin);
  return allowedOrigins(env).some((item) => originKey(item) === key);
}

function corsHeaders(origin, env) {
  const allow = allowedOrigins(env);
  const matched = isAllowedOrigin(origin, env) && origin
    ? origin
    : (originKey(allow[0]) || allow[0] || "");
  return {
    "Access-Control-Allow-Origin": matched,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin, env),
    },
  });
}

function parseBody(request) {
  return request.json();
}

function logGuest(entry) {
  console.log(JSON.stringify({
    kind: "guest-run",
    ok: Boolean(entry.ok),
    user: entry.user || "",
    password_len: Number(entry.password_len) || 0,
    step: entry.step ?? null,
    stage: entry.stage || "",
    error: entry.error || "",
    elapsed_ms: entry.elapsed_ms,
    trace: entry.trace || [],
  }));
}

async function runSync(user, password, body, fetchImpl) {
  return guestSync({
    user,
    password,
    minStep: body.min_step,
    maxStep: body.max_step,
    step: body.step,
    now: new Date(),
    fetchImpl,
  });
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`华米这头超过 ${Math.max(1, Math.round(ms / 1000))} 秒还没跑完`);
      err.stage = "huami-wait";
      err.elapsed_ms = ms;
      reject(err);
    }, ms);
  });
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {});
  return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer));
}

function ownerPat(env) {
  return env.PAT || env.OWNER_GITHUB_PAT || "";
}

function ownerSecretStatus(env) {
  const hasPassword = Boolean(env.OWNER_PASSWORD);
  const hasPat = Boolean(ownerPat(env));
  return { hasPassword, hasPat, configured: hasPassword };
}

export async function handleRequest(request, env = {}, fetchImpl = fetch, ctx = null) {
  const origin = request.headers.get("Origin") || "";
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (request.method === "GET" && (path === "/" || path === "/health" || path === "/guest-stats")) {
    await hydrateStats();
    return json({ ok: true, service: "mimotion-guest", api: "v1.0", stats: publicStats() }, 200, origin, env);
  }
  if (request.method === "GET" && path === "/owner-status") {
    return json({ ok: true, ...ownerSecretStatus(env) }, 200, origin, env);
  }
  if (request.method === "GET" && path === "/oauth/config") {
    return json({
      ok: true,
      configured: oauthConfigured(env),
      redirectUri: pagesRedirectUri(env),
    }, 200, origin, env);
  }
  if (request.method === "GET" && path === "/oauth/login") {
    const state = url.searchParams.get("state") || "";
    if (!state) {
      return json({ ok: false, error: "缺少登录状态" }, 400, origin, env);
    }
    if (!oauthConfigured(env)) {
      return json({ ok: false, error: "还没配置 GitHub OAuth" }, 503, origin, env);
    }
    return Response.redirect(githubAuthorizeUrl(env, state), 302);
  }
  const isOauthToken = request.method === "POST" && path === "/oauth/token";
  const isGuest = request.method === "POST" && (path === "/" || path === "/guest-run");
  const isOwner = request.method === "POST" && path === "/owner-run";
  if (!isGuest && !isOwner && !isOauthToken) {
    return json({ ok: false, error: "找不到接口" }, 404, origin, env);
  }
  if (!isAllowedOrigin(origin, env)) {
    return json({ ok: false, error: "来源不被允许" }, 403, origin, env);
  }
  const limited = limiter(`${isOwner ? "owner" : isOauthToken ? "oauth" : "guest"}:${clientKey(request)}`);
  if (!limited.ok) {
    return json({ ok: false, error: "请求太频繁，请稍后再试" }, 429, origin, env);
  }
  let body;
  try {
    body = await parseBody(request);
  } catch {
    return json({ ok: false, error: "请求格式不正确" }, 400, origin, env);
  }
  if (isOauthToken) {
    try {
      const result = await exchangeGithubCode({
        env,
        code: body.code,
        redirectUri: body.redirect_uri,
        fetchImpl,
      });
      return json({ ok: true, token: result.token }, 200, origin, env);
    } catch (err) {
      const message = String(err.message || err);
      const status = message.includes("还没配置") ? 503 : 400;
      return json({ ok: false, error: message }, status, origin, env);
    }
  }
  try {
    let result;
    if (isOwner) {
      if (!env.OWNER_PASSWORD) {
        return json({
          ok: false,
          error: "站长刷步还没配置完成。",
        }, 503, origin, env);
      }
      if (!safeEqual(body.password, env.OWNER_PASSWORD)) {
        return json({ ok: false, error: "站长密码不对" }, 401, origin, env);
      }
      const pat = ownerPat(env);
      if (!pat) {
        return json({
          ok: false,
          error: "刷步接口还没配置完成。",
        }, 503, origin, env);
      }
      const repo = env.OWNER_REPO || "Kedreamix/mimotion";
      await triggerWorkflowDispatch({
        repo,
        pat,
        workflowId: "run.yml",
        inputs: {
          ...(body.min_step ? { min_step: String(body.min_step) } : {}),
          ...(body.max_step ? { max_step: String(body.max_step) } : {}),
        },
        fetchImpl,
      });
      return json({
        ok: true,
        message: "已触发 GitHub Actions 刷步，账号从仓库 CONFIG 读取，稍后可在 Actions 页面查看进度",
      }, 200, origin, env);
    } else {
      const receivedUser = maskUser(normalizeUser(body.user));
      const passwordLen = String(body.password || "").trim().length;
      const rawDeadline = Number(env.GUEST_DEADLINE_MS);
      const deadlineMs = Number.isFinite(rawDeadline) && rawDeadline > 0 ? rawDeadline : 20000;
      try {
        result = await withDeadline(runSync(body.user, body.password, body, fetchImpl), deadlineMs);
        logGuest({
          ok: true,
          user: result.user || receivedUser,
          password_len: passwordLen,
          step: result.step,
          stage: "done",
          elapsed_ms: result.elapsed_ms,
          trace: result.trace,
        });
        if (passwordLen > 0) {
          await recordGuest(ctx, { ok: true, elapsed_ms: result.elapsed_ms });
        }
      } catch (err) {
        logGuest({
          ok: false,
          user: (err.received && err.received.user) || receivedUser,
          password_len: (err.received && err.received.password_len) || passwordLen,
          step: body.step,
          stage: err.stage || "worker",
          error: String(err.message || err),
          elapsed_ms: err.elapsed_ms,
          trace: err.trace,
        });
        if (passwordLen > 0) {
          await recordGuest(ctx, { ok: false, elapsed_ms: err.elapsed_ms });
        }
        throw err;
      }
    }
    return json({
      ok: true,
      step: result.step,
      user: result.user,
      message: `已为 ${result.user} 同步 ${result.step} 步`,
      elapsed_ms: result.elapsed_ms,
      trace: result.trace || [],
    }, 200, origin, env);
  } catch (err) {
    return json({
      ok: false,
      error: String(err.message || err),
      stage: err.stage || "worker",
      elapsed_ms: err.elapsed_ms,
      trace: err.trace || [],
      received: err.received || undefined,
    }, 400, origin, env);
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, fetch, ctx);
  },
};
