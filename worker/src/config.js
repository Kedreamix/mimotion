export function parseOwnerConfig(raw) {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return fromObject(raw);
  }
  const text = String(raw).trim();
  if (!text) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Worker 里的 CONFIG 不是合法 JSON。马上刷只要 USER 和 PWD，不必贴整份。");
  }
  return fromObject(data);
}

export function parseOwnerAccounts(env = {}) {
  const user = env.OWNER_USER || env.USER;
  const pwd = env.OWNER_PWD || env.PWD;
  if (String(user || "").trim() && String(pwd || "").trim()) {
    return fromObject({
      USER: user,
      PWD: pwd,
      MIN_STEP: env.MIN_STEP,
      MAX_STEP: env.MAX_STEP,
    });
  }
  return parseOwnerConfig(env.CONFIG);
}

function fromObject(data) {
  if (!data || typeof data !== "object") return null;
  const users = String(data.USER || "").split("#").map((item) => item.trim()).filter(Boolean);
  const pwds = String(data.PWD || "").split("#").map((item) => item.trim());
  if (!users.length) {
    throw new Error("还没有 Zepp 账号。Worker 里执行 wrangler secret put USER");
  }
  const accounts = users
    .map((user, index) => ({ user, password: pwds[index] || "" }))
    .filter((item) => item.password);
  if (!accounts.length) {
    throw new Error("还没有 Zepp 密码。Worker 里执行 wrangler secret put PWD");
  }
  return {
    accounts,
    minStep: data.MIN_STEP,
    maxStep: data.MAX_STEP,
  };
}
