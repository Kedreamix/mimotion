import { clientKey, createLimiter } from "./rate-limit.js";
import { guestSync } from "./zepp.js";

const limiterStore = new Map();
const limiter = createLimiter(limiterStore, { limit: 5, windowMs: 10 * 60 * 1000 });

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "https://kedreamix.github.io")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const allow = allowedOrigins(env);
  const matched = allow.includes(origin) ? origin : allow[0];
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

export async function handleRequest(request, env = {}, fetchImpl = fetch) {
  const origin = request.headers.get("Origin") || "";
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json({ ok: true, service: "mimotion-guest" }, 200, origin, env);
  }
  if (request.method !== "POST" || (url.pathname !== "/" && url.pathname !== "/guest-run")) {
    return json({ ok: false, error: "找不到接口" }, 404, origin, env);
  }
  const allow = allowedOrigins(env);
  if (origin && !allow.includes(origin)) {
    return json({ ok: false, error: "来源不被允许" }, 403, origin, env);
  }
  const limited = limiter(clientKey(request));
  if (!limited.ok) {
    return json({ ok: false, error: "请求太频繁，请稍后再试" }, 429, origin, env);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "请求格式不正确" }, 400, origin, env);
  }
  try {
    const result = await guestSync({
      user: body.user,
      password: body.password,
      minStep: body.min_step,
      maxStep: body.max_step,
      now: new Date(),
      fetchImpl,
    });
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
