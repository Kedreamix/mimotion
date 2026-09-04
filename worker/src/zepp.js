import { encryptHuami } from "./aes.js";
import { BAND_TEMPLATE } from "./band-template.js";

const UA = "MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)";

export function normalizeUser(raw) {
  const user = String(raw || "").trim();
  if (!user) return "";
  if (user.startsWith("+86") || user.includes("@")) return user;
  return `+86${user}`;
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

export function todayBeijing(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function beijingTs(now = new Date()) {
  return String(now.getTime());
}

function uuid() {
  return crypto.randomUUID();
}

function formBody(data) {
  return new URLSearchParams(data).toString();
}

async function timedFetch(fetchImpl, url, options, ms = 8000) {
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
    throw new Error(`获取 accessToken 失败 ${err}`);
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
  };
}

async function postBandData(step, appToken, userId, fetchImpl, now) {
  const t = beijingTs(now);
  const dataJson = applyBandTemplate(String(step), todayBeijing(now));
  const res = await timedFetch(fetchImpl, `https://api-mifit-cn.huami.com/v1/data/band_data.json?&t=${t}&r=${uuid()}`, {
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

export async function guestSync({ user, password, minStep, maxStep, step, now, fetchImpl }) {
  const account = normalizeUser(user);
  if (!account || !password) {
    throw new Error("请填写自己的 Zepp Life 账号和密码");
  }
  const isPhone = account.startsWith("+86");
  const deviceId = uuid();
  const access = await loginAccessToken(account, password, fetchImpl);
  const tokens = await grantLoginTokens(access, deviceId, isPhone, fetchImpl);
  const exact = step != null && step !== "" ? clampStep(step) : null;
  if (step != null && step !== "" && exact == null) {
    throw new Error("步数不正确");
  }
  const range = (!minStep && !maxStep) ? stepRangeByTime(now) : {
    min: Number(minStep) || 18000,
    max: Number(maxStep) || 25000,
  };
  const chosen = exact ?? pickStep(range.min, range.max);
  await postBandData(chosen, tokens.appToken, tokens.userId, fetchImpl, now);
  return { step: chosen, user: maskUser(account) };
}
