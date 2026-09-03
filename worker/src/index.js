import { clientKey, createLimiter } from "./rate-limit.js";
import { exchangeGithubCode, githubAuthorizeUrl, oauthConfigured, pagesRedirectUri } from "./oauth.js";
import { safeEqual } from "./secret.js";
import { guestSync } from "./zepp.js";

const limiterStore = new Map();
const limiter = createLimiter(limiterStore, { limit: 5, windowMs: 10 * 60 * 1000 });

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

async function runSync(user, password, body, fetchImpl) {
  return guestSync({
    user,
    password,
    minStep: body.min_step,
    maxStep: body.max_step,
    now: new Date(),
    fetchImpl,
  });
}

export async function handleRequest(request, env = {}, fetchImpl = fetch) {
  const origin = request.headers.get("Origin") || "";
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json({ ok: true, service: "mimotion-guest" }, 200, origin, env);
  }
  const path = url.pathname.replace(/\/$/, "") || "/";
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
        return json({ ok: false, error: "站长刷步还没配置 Worker 密钥" }, 503, origin, env);
      }
      if (!safeEqual(body.password, env.OWNER_PASSWORD)) {
        return json({ ok: false, error: "站长密码不对" }, 401, origin, env);
      }
      if (!env.OWNER_USER || !env.OWNER_PWD) {
        return json({ ok: false, error: "站长刷步还没配置 Worker 密钥" }, 503, origin, env);
      }
      result = await runSync(env.OWNER_USER, env.OWNER_PWD, body, fetchImpl);
    } else {
      result = await runSync(body.user, body.password, body, fetchImpl);
    }
    return json({
      ok: true,
      step: result.step,
      user: result.user,
      message: `已为 ${result.user} 同步 ${result.step} 步`,
    }, 200, origin, env);
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) }, 400, origin, env);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env, fetch);
  },
};
