import { CREATE_TODAY_STEPS, hasD1 } from "./usage.js";

export const LAST_STEPS_CACHE_URL = "https://mimotion.internal/last-steps";

function resolveCache(ctx) {
  if (ctx && ctx.cache) return ctx.cache;
  if (typeof caches === "undefined") return null;
  try {
    return caches.default;
  } catch {
    return null;
  }
}

function normalizePayload(payload) {
  const steps = Number(payload && payload.steps);
  if (!payload || !Number.isFinite(steps)) return null;
  return {
    date: String(payload.date || ""),
    steps,
    fetched_at: Number(payload.fetched_at) || Date.now(),
    source: payload.source || "huami",
  };
}

async function saveD1(db, payload) {
  if (!db || typeof db.prepare !== "function") return;
  await db.prepare(CREATE_TODAY_STEPS).run();
  await db.prepare(
    "INSERT INTO owner_today_steps (id, date, steps, fetched_at, source) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, steps = excluded.steps, fetched_at = excluded.fetched_at, source = excluded.source",
  ).bind(payload.date, payload.steps, payload.fetched_at, payload.source).run();
}

async function readD1(db) {
  if (!db || typeof db.prepare !== "function") return null;
  await db.prepare(CREATE_TODAY_STEPS).run();
  const row = await db.prepare("SELECT date, steps, fetched_at, source FROM owner_today_steps WHERE id = 1").first();
  return normalizePayload(row);
}

async function saveCache(cache, payload, ctx) {
  if (!cache) return;
  const persist = cache.put(LAST_STEPS_CACHE_URL, new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=604800",
    },
  }));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(persist);
  else await persist;
}

async function readCache(cache) {
  if (!cache) return null;
  try {
    const hit = await cache.match(LAST_STEPS_CACHE_URL);
    if (!hit) return null;
    const body = await hit.json();
    return normalizePayload(body);
  } catch {
    return null;
  }
}

export async function saveLastSteps(env, payload, ctx = null) {
  const record = normalizePayload(payload);
  if (!record) return;
  try {
    if (hasD1(env)) await saveD1(env.DB, record);
  } catch {
    /* D1 记失败时再试 Cache */
  }
  try {
    await saveCache(resolveCache(ctx), record, ctx);
  } catch {
    /* Cache API 不可用时忽略 */
  }
}

export async function readLastSteps(env, ctx = null) {
  try {
    if (hasD1(env)) {
      const row = await readD1(env.DB);
      if (row) return row;
    }
  } catch {
    /* 读 D1 失败时再试 Cache */
  }
  try {
    return await readCache(resolveCache(ctx));
  } catch {
    return null;
  }
}
