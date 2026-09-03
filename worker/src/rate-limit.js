export function createLimiter(store, { limit = 5, windowMs = 10 * 60 * 1000 } = {}) {
  return (key, now = Date.now()) => {
    const rec = store.get(key);
    if (!rec || now > rec.reset) {
      store.set(key, { n: 1, reset: now + windowMs });
      return { ok: true, remaining: limit - 1 };
    }
    rec.n += 1;
    store.set(key, rec);
    return { ok: rec.n <= limit, remaining: Math.max(0, limit - rec.n) };
  };
}

export function clientKey(request) {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("x-forwarded-for")
    || "local";
}
