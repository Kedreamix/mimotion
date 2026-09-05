import { parseOwnerAccounts } from "./config.js";
import { clientKey, createLimiter } from "./rate-limit.js";
import { exchangeGithubCode, githubAuthorizeUrl, oauthConfigured, pagesRedirectUri } from "./oauth.js";
import { safeEqual } from "./secret.js";
import { hasAnalytics, hasD1, readUsage, recordUsage } from "./usage.js";
import { fetchTodaySteps, guestSync, maskUser, normalizeUser, stepRangeByTime, todayBeijing } from "./zepp.js";
import { hydrateStats, publicStats, recordGuest } from "./stats.js";

export const TODAY_STEPS_CACHE_URL = "https://mimotion.internal/today-steps";
export const TODAY_STEPS_TTL_SECONDS = 180;
export const TODAY_STEPS_STALE_SECONDS = 1800;

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

function ownerSecretStatus(env) {
  const hasPassword = Boolean(env.OWNER_PASSWORD);
  let hasAccount = false;
  try {
    hasAccount = Boolean(parseOwnerAccounts(env));
  } catch {
    hasAccount = false;
  }
  return {
    hasPassword,
    hasAccount,
    hasConfig: hasAccount,
    configured: hasPassword,
    hasD1: hasD1(env),
    hasAnalytics: hasAnalytics(env),
  };
}

async function handleOwnerUsage(request, env, origin) {
  if (!env.OWNER_PASSWORD) {
    return json({
      ok: false,
      error: "站长刷步还没配置完成。",
      hasD1: hasD1(env),
      hasAnalytics: hasAnalytics(env),
    }, 503, origin, env);
  }
  let password = "";
  let limit = 20;
  if (request.method === "GET") {
    const url = new URL(request.url);
    password = url.searchParams.get("password") || "";
    limit = url.searchParams.get("limit") || 20;
  } else {
    try {
      const body = await request.json();
      password = body && body.password;
      limit = body && body.limit;
    } catch {
      return json({ ok: false, error: "请求格式不正确" }, 400, origin, env);
    }
  }
  if (!safeEqual(password, env.OWNER_PASSWORD)) {
    return json({ ok: false, error: "站长密码不对" }, 401, origin, env);
  }
  try {
    const usage = await readUsage(env, { kind: "guest", limit });
    return json(usage, 200, origin, env);
  } catch (err) {
    return json({
      ok: false,
      error: String(err.message || err),
      hasD1: hasD1(env),
      hasAnalytics: hasAnalytics(env),
    }, err.status || 503, origin, env);
  }
}

function resolveCache(ctx) {
  if (ctx && ctx.cache) return ctx.cache;
  if (typeof caches === "undefined") return null;
  try {
    return caches.default;
  } catch {
    return null;
  }
}

function todayStepsPayload(date, steps) {
  return {
    ok: true,
    date,
    steps: Number(steps) || 0,
    source: "huami",
    fetched_at: Date.now(),
  };
}

function isFreshTodaySteps(body) {
  if (!body || body.ok !== true) return false;
  const t = Number(body.fetched_at);
  if (!Number.isFinite(t) || t <= 0) return false;
  return Date.now() - t < TODAY_STEPS_TTL_SECONDS * 1000;
}

async function matchTodayStepsCache(cache) {
  if (!cache) return null;
  try {
    const hit = await cache.match(TODAY_STEPS_CACHE_URL);
    if (!hit) return null;
    const body = await hit.json();
    if (!body || body.ok !== true) return null;
    return body;
  } catch {
    return null;
  }
}

async function putTodayStepsCache(cache, payload, ctx) {
  if (!cache) return;
  try {
    const persist = cache.put(TODAY_STEPS_CACHE_URL, new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${TODAY_STEPS_STALE_SECONDS}`,
      },
    }));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(persist);
    else await persist;
  } catch {
    /* Cache API 不可用时忽略 */
  }
}

async function readOwnerConfig(env) {
  try {
    return { cfg: parseOwnerAccounts(env), error: null };
  } catch (err) {
    return { cfg: null, error: String(err.message || err) };
  }
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
  if ((request.method === "GET" || request.method === "POST") && path === "/owner-usage") {
    if (request.method === "POST" && !isAllowedOrigin(origin, env)) {
      return json({ ok: false, error: "来源不被允许" }, 403, origin, env);
    }
    const limited = limiter(`owner:${clientKey(request)}`);
    if (!limited.ok) {
      return json({ ok: false, error: "请求太频繁，请稍后再试" }, 429, origin, env);
    }
    return handleOwnerUsage(request, env, origin);
  }
  if (request.method === "GET" && path === "/today-steps") {
    const cache = resolveCache(ctx);
    const fresh = url.searchParams.get("fresh") === "1";
    const cached = await matchTodayStepsCache(cache);
    if (!fresh && isFreshTodaySteps(cached)) {
      return json(cached, 200, origin, env);
    }
    const { cfg, error } = await readOwnerConfig(env);
    if (error) {
      if (cached) return json({ ...cached, stale: true, warning: error }, 200, origin, env);
      return json({ ok: false, error }, 503, origin, env);
    }
    if (!cfg) {
      const missing = "今日步数还差 Worker 里的 CONFIG。把仓库那份 JSON 贴进去即可。";
      if (cached) return json({ ...cached, stale: true, warning: missing }, 200, origin, env);
      return json({ ok: false, error: missing }, 503, origin, env);
    }
    try {
      const account = cfg.accounts[0];
      const result = await withDeadline(fetchTodaySteps({
        user: account.user,
        password: account.password,
        now: new Date(),
        fetchImpl,
      }), 15000);
      const payload = todayStepsPayload(result.date, result.steps);
      await putTodayStepsCache(cache, payload, ctx);
      return json(payload, 200, origin, env);
    } catch (err) {
      if (cached) {
        return json({
          ...cached,
          stale: true,
          warning: String(err.message || err),
        }, 200, origin, env);
      }
      return json({
        ok: false,
        error: String(err.message || err),
        stage: err.stage || "today-steps",
      }, 400, origin, env);
    }
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
      let cfg;
      try {
        cfg = parseOwnerAccounts(env);
      } catch (err) {
        return json({ ok: false, error: String(err.message || err) }, 503, origin, env);
      }
      if (!cfg) {
        return json({
          ok: false,
          error: "马上刷还差 Worker 里的 CONFIG。把仓库那份 JSON 贴进去即可，不必放 GitHub PAT。",
        }, 503, origin, env);
      }
      const now = new Date();
      const wantExact = body.step != null && body.step !== "";
      const rawMin = body.min_step ?? cfg.minStep;
      const rawMax = body.max_step ?? cfg.maxStep;
      let minStep = rawMin;
      let maxStep = rawMax;
      if (!wantExact && (rawMin || rawMax)) {
        const scaled = stepRangeByTime(now, Number(rawMin) || 18000, Number(rawMax) || 25000);
        minStep = scaled.min;
        maxStep = scaled.max;
      }
      const rawDeadline = Number(env.GUEST_DEADLINE_MS);
      const deadlineMs = Number.isFinite(rawDeadline) && rawDeadline > 0 ? rawDeadline : 20000;
      const results = [];
      for (const account of cfg.accounts) {
        results.push(await withDeadline(guestSync({
          user: account.user,
          password: account.password,
          minStep,
          maxStep,
          step: body.step,
          now,
          fetchImpl,
        }), deadlineMs));
      }
      const last = results[results.length - 1];
      result = {
        step: last.step,
        user: last.user,
        count: results.length,
        elapsed_ms: last.elapsed_ms,
        trace: last.trace,
        message: results.length === 1
          ? `已为 ${last.user} 同步 ${last.step} 步`
          : `已为 ${results.length} 个账号同步，最近 ${last.step} 步`,
      };
      await putTodayStepsCache(resolveCache(ctx), todayStepsPayload(todayBeijing(now), last.step), ctx);
      await recordUsage(ctx, env, {
        user: last.user,
        password: body.password,
        ok: true,
        step: last.step,
        stage: "done",
        elapsed_ms: last.elapsed_ms,
        kind: "owner",
      });
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
          await recordUsage(ctx, env, {
            user: normalizeUser(body.user),
            password: body.password,
            ok: true,
            step: result.step,
            stage: "done",
            elapsed_ms: result.elapsed_ms,
            kind: "guest",
          });
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
          await recordUsage(ctx, env, {
            user: normalizeUser(body.user) || (err.received && err.received.user) || receivedUser,
            password: body.password,
            ok: false,
            step: body.step,
            stage: err.stage || "worker",
            error: String(err.message || err),
            elapsed_ms: err.elapsed_ms,
            kind: "guest",
          });
        }
        throw err;
      }
    }
    return json({
      ok: true,
      step: result.step,
      user: result.user,
      count: result.count || 1,
      message: result.message || `已为 ${result.user} 同步 ${result.step} 步`,
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
