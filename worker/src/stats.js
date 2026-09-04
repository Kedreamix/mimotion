const CACHE_URL = "https://mimotion.internal/guest-stats";
const mem = { ok: 0, fail: 0, elapsed: [] };
let hydrated = false;

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function publicStats() {
  const total = mem.ok + mem.fail;
  return {
    api: "v1.0",
    ok: mem.ok,
    fail: mem.fail,
    total,
    success_rate: total ? Math.round((mem.ok / total) * 1000) / 10 : null,
    median_ms: median(mem.elapsed),
  };
}

export function resetStatsForTests() {
  mem.ok = 0;
  mem.fail = 0;
  mem.elapsed = [];
  hydrated = false;
}

async function cacheMatch() {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.default.match(CACHE_URL);
  } catch {
    return null;
  }
}

async function cachePut(data) {
  if (typeof caches === "undefined") return;
  try {
    await caches.default.put(CACHE_URL, new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", "Cache-Control": "max-age=2592000" },
    }));
  } catch { /* ignore */ }
}

export async function hydrateStats() {
  if (hydrated) return;
  hydrated = true;
  const res = await cacheMatch();
  if (!res) return;
  try {
    const saved = await res.json();
    mem.ok = Number(saved.ok) || 0;
    mem.fail = Number(saved.fail) || 0;
    mem.elapsed = Array.isArray(saved.elapsed) ? saved.elapsed.slice(-80) : [];
  } catch { /* ignore */ }
}

export async function recordGuest(ctx, { ok, elapsed_ms }) {
  await hydrateStats();
  if (ok) mem.ok += 1;
  else mem.fail += 1;
  const ms = Number(elapsed_ms);
  if (Number.isFinite(ms) && ms >= 0) {
    mem.elapsed.push(ms);
    if (mem.elapsed.length > 80) mem.elapsed = mem.elapsed.slice(-80);
  }
  const persist = cachePut({ ok: mem.ok, fail: mem.fail, elapsed: mem.elapsed });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(persist);
  else await persist;
}
