export function hasD1(env = {}) {
  return Boolean(env && env.DB && typeof env.DB.prepare === "function");
}

export function hasAnalytics(env = {}) {
  return Boolean(env && env.USAGE && typeof env.USAGE.writeDataPoint === "function");
}

const CREATE_TABLE = "CREATE TABLE IF NOT EXISTS guest_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, user TEXT NOT NULL, ok INTEGER NOT NULL, step INTEGER, stage TEXT, error TEXT, elapsed_ms INTEGER, kind TEXT NOT NULL DEFAULT 'guest')";
const CREATE_KIND_INDEX = "CREATE INDEX IF NOT EXISTS idx_guest_runs_kind ON guest_runs(kind)";
const CREATE_CREATED_INDEX = "CREATE INDEX IF NOT EXISTS idx_guest_runs_created ON guest_runs(created_at)";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeError(message, extras = []) {
  let text = String(message || "");
  const secrets = extras.map((item) => String(item || "").trim()).filter((item) => item.length >= 4);
  for (const secret of secrets) {
    text = text.split(secret).join("[已隐藏]");
  }
  text = text.replace(/(password|passwd|pwd)\s*[:=]\s*([^\s,;]+)/gi, "$1=[已隐藏]");
  return text.slice(0, 240);
}

export function usageRow({
  user,
  password,
  ok,
  step,
  stage,
  error,
  elapsed_ms,
  kind = "guest",
  now = new Date(),
}) {
  const row = {
    created_at: now.toISOString(),
    user: String(user || ""),
    ok: ok ? 1 : 0,
    step: Number.isFinite(Number(step)) ? Number(step) : null,
    stage: String(stage || ""),
    error: sanitizeError(error, [password]),
    elapsed_ms: Number.isFinite(Number(elapsed_ms)) ? Number(elapsed_ms) : null,
    kind: kind === "owner" ? "owner" : "guest",
  };
  return row;
}

async function runSql(db, sql) {
  const stmt = db.prepare(sql);
  if (typeof stmt.run === "function") return stmt.run();
  if (typeof stmt.bind === "function") return stmt.bind().run();
}

export async function ensureSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  await runSql(db, CREATE_TABLE);
  await runSql(db, CREATE_KIND_INDEX);
  await runSql(db, CREATE_CREATED_INDEX);
}

async function insertUsage(db, row) {
  await ensureSchema(db);
  await db.prepare(
    `INSERT INTO guest_runs (created_at, user, ok, step, stage, error, elapsed_ms, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.created_at,
    row.user,
    row.ok,
    row.step,
    row.stage,
    row.error,
    row.elapsed_ms,
    row.kind,
  ).run();
}

function writeAnalytics(env, row) {
  if (!hasAnalytics(env)) return;
  try {
    env.USAGE.writeDataPoint({
      blobs: [row.kind, row.user, row.ok ? "ok" : "fail", row.stage || ""],
      doubles: [Number(row.step) || 0, Number(row.elapsed_ms) || 0],
      indexes: [row.kind],
    });
  } catch {
    /* Analytics Engine 失败不影响迈步 */
  }
}

async function persistUsage(env, row) {
  writeAnalytics(env, row);
  if (!hasD1(env)) return;
  try {
    await insertUsage(env.DB, row);
  } catch {
    /* D1 失败不影响迈步 */
  }
}

export function recordUsage(ctx, env, entry) {
  const row = usageRow(entry);
  const task = persistUsage(env, row);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
    return Promise.resolve();
  }
  return task;
}

function clampLimit(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, n));
}

export async function readUsage(env, { kind = "guest", limit = 20 } = {}) {
  if (!hasD1(env)) {
    const err = new Error("还没绑 D1。在 Worker Bindings 里加上 DB。");
    err.status = 503;
    throw err;
  }
  await ensureSchema(env.DB);
  const wantKind = kind === "owner" ? "owner" : "guest";
  const capped = clampLimit(limit);
  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT user) AS unique_users,
            SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_count
     FROM guest_runs WHERE kind = ?`,
  ).bind(wantKind).first();
  const recent = await env.DB.prepare(
    `SELECT id, created_at, user, ok, step, stage, error, elapsed_ms, kind
     FROM guest_runs WHERE kind = ? ORDER BY id DESC LIMIT ?`,
  ).bind(wantKind, capped).all();
  const total = Number(summary && summary.total) || 0;
  const okCount = Number(summary && summary.ok_count) || 0;
  return {
    ok: true,
    kind: wantKind,
    total,
    unique_users: Number(summary && summary.unique_users) || 0,
    ok_count: okCount,
    fail_count: Math.max(0, total - okCount),
    recent: Array.isArray(recent && recent.results) ? recent.results : [],
    hasD1: true,
    hasAnalytics: hasAnalytics(env),
  };
}
