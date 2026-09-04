import { encryptHuami } from "./aes.js";
import { BAND_TEMPLATE } from "./band-template.js";

const UA = "MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)";

export function normalizeUser(raw) {
  let user = String(raw || "").trim();
  if (!user) return "";
  if (user.includes("@")) return user.replace(/\s+/g, "");
  user = user.replace(/[\s-]/g, "");
  if (user.startsWith("+86")) return user;
  if (/^86\d{11}$/.test(user)) return `+${user}`;
  return `+86${user}`;
}

export function describeLoginError(code) {
  let raw = String(code || "unknown");
  try {
    raw = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    /* keep raw */
  }
  if (raw === "401" || raw === "403" || /unauthorized/i.test(raw)) {
    return "请检查密码。要用 Zepp Life 自己的邮箱/手机和密码，不要用小米账号快捷登录。";
  }
  return `获取 accessToken 失败 ${raw}`;
}

export function maskUser(user) {
  const value = String(user || "");
  if (value.length <= 8) {
    const n = Math.max(1, Math.floor(value.length / 3));
    return `${value.slice(0, n)}***${value.slice(-n)}`;
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function stepRangeByTime(now = new Date(), minStep = 18000, maxStep = 25000) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const hour = bj.getUTCHours();
  const minute = bj.getUTCMinutes();
  const rate = Math.min((hour * 60 + minute) / (22 * 60), 1);
  const min = Math.max(1000, Math.floor(rate * minStep));
  const max = Math.max(min, Math.floor(rate * maxStep));
  return { min, max };
}

export function clampStep(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(98800, n));
}

export function pickStep(minStep, maxStep) {
  const low = Math.max(1, Number(minStep) || 18000);
  const high = Math.min(98800, Math.max(low, Number(maxStep) || 25000));
  return low + Math.floor(Math.random() * (high - low + 1));
}

export const DEFAULT_BAND_HOST = "https://api-mifit-cn.huami.com";

export function todayBeijing(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function regionHostFromLogin(body) {
  const domains = body && body.domains;
  if (domains && typeof domains === "object") {
    const mapped = domains["api-mifit.huami.com"] || domains["api-mifit.zepp.com"];
    if (typeof mapped === "string" && mapped.trim()) {
      const host = mapped.trim().replace(/\/$/, "");
      if (/^https?:\/\//i.test(host)) return host;
      return `https://${host}`;
    }
  }
  return DEFAULT_BAND_HOST;
}

function tryJson(text) {
  try {
    let value = JSON.parse(text);
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        /* keep the first parse */
      }
    }
    return value;
  } catch {
    return null;
  }
}

function decodeBase64Utf8(raw) {
  const normalized = String(raw || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return "";
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function ttlFromObject(obj) {
  if (obj == null) return null;
  if (typeof obj === "number" && Number.isFinite(obj)) return Math.max(0, Math.floor(obj));
  if (typeof obj !== "object") return null;
  const stp = obj.stp;
  if (typeof stp === "number" && Number.isFinite(stp)) return Math.max(0, Math.floor(stp));
  if (stp && typeof stp === "object") {
    const n = Number(stp.ttl ?? stp.total ?? stp.step);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  const n = Number(obj.ttl);
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return null;
}

export function parseSummarySteps(summary) {
  if (summary == null || summary === "") return null;
  if (typeof summary === "number" && Number.isFinite(summary)) return Math.max(0, Math.floor(summary));
  if (typeof summary === "object") return ttlFromObject(summary);
  const text = String(summary).trim();
  if (!text) return null;
  const asJson = tryJson(text);
  if (asJson != null) {
    const fromJson = ttlFromObject(asJson);
    if (fromJson != null) return fromJson;
  }
  try {
    const decoded = decodeBase64Utf8(text);
    const nested = tryJson(decoded);
    if (nested != null) return ttlFromObject(nested);
  } catch {
    /* not base64 */
  }
  return null;
}

export function stepsFromBandData(body, date) {
  const rows = Array.isArray(body && body.data) ? body.data : [];
  if (!rows.length) return 0;
  const wanted = String(date || "");
  const row = rows.find((item) => String(item.date || item.date_time || "") === wanted) || rows[0];
  const steps = parseSummarySteps(row && row.summary);
  if (steps == null) throw new Error("无法解析华米当日步数");
  return steps;
}

function beijingTs(now = new Date()) {
  return String(now.getTime());
}

function uuid() {
  return crypto.randomUUID();
}

export function quotePlus(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function formBody(data) {
  return Object.entries(data)
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(value ?? "")}`)
    .join("&");
}

async function timedFetch(fetchImpl, url, options, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err && (err.name === "AbortError" || String(err.message || "").includes("aborted"))) {
      throw new Error("华米接口超时，请再试一次");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function applyBandTemplate(step, date) {
  const dated = BAND_TEMPLATE.replace(/date%22%3A%22(.*?)%22%2C%22data/, `date%22%3A%22${date}%22%2C%22data`);
  return dated.replace(/ttl%5C%22%3A(.*?)%2C%5C%22dis/, `ttl%5C%22%3A${step}%2C%5C%22dis`);
}

async function loginAccessToken(user, password, fetchImpl) {
  const query = formBody({
    emailOrPhone: user,
    password,
    state: "REDIRECTION",
    client_id: "HuaMi",
    country_code: "CN",
    token: "access",
    redirect_uri: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html",
  });
  const cipher = await encryptHuami(query);
  const res = await timedFetch(fetchImpl, "https://api-user.zepp.com/v2/registrations/tokens", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": UA,
      app_name: "com.xiaomi.hm.health",
      appname: "com.xiaomi.hm.health",
      appplatform: "android_phone",
      "x-hm-ekv": "1",
      "hm-privacy-ceip": "false",
    },
    body: cipher,
  });
  if (res.status !== 303) {
    throw new Error(`登录异常，status: ${res.status}`);
  }
  const location = res.headers.get("Location") || "";
  const access = (location.match(/access=([^&]+)/) || [])[1];
  if (!access) {
    const err = (location.match(/error=([^&]+)/) || [])[1] || "unknown";
    throw new Error(describeLoginError(err));
  }
  return decodeURIComponent(access);
}

async function grantLoginTokens(accessToken, deviceId, isPhone, fetchImpl) {
  const data = isPhone
    ? {
      app_name: "com.xiaomi.hm.health",
      app_version: "6.14.0",
      code: accessToken,
      country_code: "CN",
      device_id: deviceId,
      device_model: "phone",
      grant_type: "access_token",
      third_name: "huami_phone",
    }
    : {
      app_name: "com.xiaomi.hm.health",
      app_version: "6.14.0",
      code: accessToken,
      country_code: "CN",
      device_id: deviceId,
      device_model: "android_phone",
      dn: "account.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,api-analytics.huami.com,auth.zepp.com",
      grant_type: "access_token",
      lang: "zh_CN",
      os_version: "1.5.0",
      source: "com.xiaomi.hm.health:6.14.0:50818",
      third_name: "email",
    };
  const res = await timedFetch(fetchImpl, "https://account.huami.com/v2/client/login", {
    method: "POST",
    headers: {
      app_name: "com.xiaomi.hm.health",
      "x-request-id": uuid(),
      "accept-language": "zh-CN",
      appname: "com.xiaomi.hm.health",
      cv: "50818_6.14.0",
      v: "2.0",
      appplatform: "android_phone",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: formBody(data),
  });
  const body = await res.json();
  if (body.result !== "ok") {
    throw new Error(`客户端登录失败：${body.result || res.status}`);
  }
  return {
    loginToken: body.token_info.login_token,
    appToken: body.token_info.app_token,
    userId: body.token_info.user_id,
    regionHost: regionHostFromLogin(body),
  };
}

async function postBandData(step, appToken, userId, fetchImpl, now) {
  const t = beijingTs(now);
  const dataJson = applyBandTemplate(String(step), todayBeijing(now));
  const res = await timedFetch(fetchImpl, `${DEFAULT_BAND_HOST}/v1/data/band_data.json?&t=${t}&r=${uuid()}`, {
    method: "POST",
    headers: {
      apptoken: appToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `userid=${encodeURIComponent(userId)}&last_sync_data_time=1597306380&device_type=0&last_deviceid=DA932FFFFE8816E7&data_json=${dataJson}`,
  });
  if (res.status !== 200) {
    throw new Error(`提交步数异常：${res.status}`);
  }
  const body = await res.json();
  if (body.message !== "success") {
    throw new Error(body.message || "提交失败");
  }
  return body.message;
}

function summaryQuery(userId, date, extra = {}) {
  const t = beijingTs();
  return new URLSearchParams({
    query_type: "summary",
    userid: String(userId),
    from_date: date,
    to_date: date,
    t,
    r: uuid(),
    ...extra,
  });
}

function huamiStatusError(prefix, status, text) {
  const parsed = tryJson(text);
  const hint = parsed && parsed.message ? String(parsed.message).slice(0, 80) : "";
  return new Error(hint ? `${prefix}${status} ${hint}` : `${prefix}${status}`);
}

async function getBandSummary(appToken, userId, date, fetchImpl) {
  const attempts = [
    { device_type: "android_phone" },
    { device_type: "0", byteLength: "8" },
  ];
  let lastError = new Error("读取步数异常");
  for (const extra of attempts) {
    const res = await timedFetch(fetchImpl, `${DEFAULT_BAND_HOST}/v1/data/band_data.json?${summaryQuery(userId, date, extra)}`, {
      method: "GET",
      headers: {
        apptoken: appToken,
        appname: "com.xiaomi.hm.health",
        "user-agent": UA,
      },
    });
    const text = await res.text();
    if (res.status !== 200) {
      lastError = huamiStatusError("读取步数异常：", res.status, text);
      continue;
    }
    const body = tryJson(text);
    if (!body) {
      lastError = new Error("读取步数失败");
      continue;
    }
    const code = Number(body.code);
    if (body.message && body.message !== "success" && code !== 1) {
      lastError = new Error(body.message || "读取步数失败");
      continue;
    }
    return body;
  }
  throw lastError;
}

export async function fetchTodaySteps({ user, password, now, fetchImpl }) {
  const account = normalizeUser(user);
  const pwd = String(password || "").trim();
  if (!account || !pwd) {
    throw new Error("请填写自己的 Zepp Life 账号和密码");
  }
  const isPhone = account.startsWith("+86");
  const deviceId = uuid();
  const access = await loginAccessToken(account, pwd, fetchImpl);
  const tokens = await grantLoginTokens(access, deviceId, isPhone, fetchImpl);
  const date = todayBeijing(now);
  const body = await getBandSummary(tokens.appToken, tokens.userId, date, fetchImpl);
  return {
    date,
    steps: stepsFromBandData(body, date),
    source: "huami",
    user: maskUser(account),
  };
}

export async function guestSync({ user, password, minStep, maxStep, step, now, fetchImpl }) {
  const account = normalizeUser(user);
  const pwd = String(password || "").trim();
  if (!account || !pwd) {
    throw new Error("请填写自己的 Zepp Life 账号和密码");
  }
  const started = Date.now();
  const trace = [];
  let stage = "prepare";
  let last = started;
  const stamp = (name) => {
    const t = Date.now();
    trace.push({ stage: name, ms: t - last });
    last = t;
    stage = name;
  };
  try {
    const isPhone = account.startsWith("+86");
    const deviceId = uuid();
    stage = "login";
    const access = await loginAccessToken(account, pwd, fetchImpl);
    stamp("login");
    stage = "grant";
    const tokens = await grantLoginTokens(access, deviceId, isPhone, fetchImpl);
    stamp("grant");
    const exact = step != null && step !== "" ? clampStep(step) : null;
    if (step != null && step !== "" && exact == null) {
      throw new Error("步数不正确");
    }
    const range = (!minStep && !maxStep) ? stepRangeByTime(now) : {
      min: Number(minStep) || 18000,
      max: Number(maxStep) || 25000,
    };
    const chosen = exact ?? pickStep(range.min, range.max);
    stage = "upload";
    await postBandData(chosen, tokens.appToken, tokens.userId, fetchImpl, now);
    stamp("upload");
    return {
      step: chosen,
      user: maskUser(account),
      trace,
      elapsed_ms: Date.now() - started,
    };
  } catch (err) {
    err.stage = stage;
    err.trace = trace;
    err.elapsed_ms = Date.now() - started;
    err.received = { user: maskUser(account), password_len: pwd.length };
    throw err;
  }
}
