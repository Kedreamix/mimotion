import assert from "node:assert/strict";
import test from "node:test";
import { encryptHuami } from "../worker/src/aes.js";
import { handleRequest, TODAY_STEPS_CACHE_URL } from "../worker/src/index.js";
import { safeEqual } from "../worker/src/secret.js";
import { hasAnalytics, hasD1, sanitizeError, usageRow } from "../worker/src/usage.js";
import { resetStatsForTests } from "../worker/src/stats.js";
import { applyBandTemplate, clampStep, describeLoginError, formBody, maskUser, normalizeUser, parseSummarySteps, regionHostFromLogin, stepRangeByTime, stepsFromBandData, todayBeijing } from "../worker/src/zepp.js";
import { createLimiter } from "../worker/src/rate-limit.js";

const PYTHON_PLAIN = "emailOrPhone=%2B8613800138000&password=secret&state=REDIRECTION&client_id=HuaMi&country_code=CN&token=access&redirect_uri=https%3A%2F%2Fs3-us-west-2.amazonaws.com%2Fhm-registration%2Fsuccesssignin.html";
const PYTHON_HEX = "c43c0bbec04ee1b3f430164f237ae2a2cb66e050c21445c97064dfdaea58f88f35ed5bc458f237ac3a50bb0d2af215a43f01bbf5ee9dbf6d160aa119f5291205d1050845114a29c568a5dcc4e6309766ab0223e28d6fab29c3671b7f4ad7cea1d1426b005f746728682c10ab37fc1990b8373eafb1ece7538a0d0c83ba0f4377466efc0d347d79f761aa965286a444e96ebcc96c3ad8049a5396e94ab76d9d17cb3dc9d2f2e91ec394c601ead6a863568365e0a0590e0057f1530d2c508f00542b1302eb44ab9ad00b42f838ef1529ec";

function hex(bytes) {
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function decryptHuami(cipher) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("xeNtBVqzDc6tuNTh"),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode("MAAAYAAAAAAAAABg") },
    key,
    cipher,
  );
  return new TextDecoder().decode(plain);
}

test("AES-CBC matches Python Huami login encryption", async () => {
  const cipher = await encryptHuami(PYTHON_PLAIN);
  assert.equal(hex(cipher), PYTHON_HEX);
});

test("normalize phone and mask user", () => {
  assert.equal(normalizeUser("13800138000"), "+8613800138000");
  assert.equal(normalizeUser("86 138-0013-8000"), "+8613800138000");
  assert.equal(normalizeUser("a@b.com"), "a@b.com");
  assert.equal(maskUser("+8613800138000"), "+86****8000");
});

test("describeLoginError turns Huami 401 into a password hint", () => {
  assert.match(describeLoginError("401"), /请检查密码/);
  assert.match(describeLoginError("oops"), /oops/);
});

test("formBody matches Python urllib.parse.urlencode", () => {
  const query = formBody({
    emailOrPhone: "a@b.com",
    password: "a!b*c(d)e~f'g",
    state: "REDIRECTION",
    client_id: "HuaMi",
    country_code: "CN",
    token: "access",
    redirect_uri: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html",
  });
  assert.equal(
    query,
    "emailOrPhone=a%40b.com&password=a%21b%2Ac%28d%29e~f%27g&state=REDIRECTION&client_id=HuaMi&country_code=CN&token=access&redirect_uri=https%3A%2F%2Fs3-us-west-2.amazonaws.com%2Fhm-registration%2Fsuccesssignin.html",
  );
});

test("clampStep stays within 1 and 98800", () => {
  assert.equal(clampStep(54188), 54188);
  assert.equal(clampStep(0), 1);
  assert.equal(clampStep(999999), 98800);
  assert.equal(clampStep("nope"), null);
});

test("time scaled step range grows toward evening", () => {
  const morning = stepRangeByTime(new Date("2026-09-03T02:00:00Z"));
  const evening = stepRangeByTime(new Date("2026-09-03T14:00:00Z"));
  assert.ok(morning.max < evening.max);
  assert.ok(evening.max <= 25000);
});

test("band template injects date and step", () => {
  const out = applyBandTemplate("12345", "2026-09-03");
  assert.match(out, /date%22%3A%222026-09-03%22/);
  assert.match(out, /ttl%5C%22%3A12345%2C%5C%22dis/);
});

test("parseSummarySteps reads stp.ttl from base64 JSON and raw JSON string", () => {
  const payload = { stp: { ttl: 54188, dis: 36000 } };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  assert.equal(parseSummarySteps(b64), 54188);
  assert.equal(parseSummarySteps(JSON.stringify(payload)), 54188);
  assert.equal(parseSummarySteps(payload), 54188);
  assert.equal(parseSummarySteps('{"stp":{"ttl":888}}'), 888);
});

test("stepsFromBandData matches Beijing date and falls back to first row", () => {
  const body = {
    code: 1,
    message: "success",
    data: [
      { date: "2026-09-03", summary: JSON.stringify({ stp: { ttl: 100 } }) },
      { date: "2026-09-04", summary: Buffer.from(JSON.stringify({ stp: { ttl: 2222 } })).toString("base64") },
    ],
  };
  assert.equal(stepsFromBandData(body, "2026-09-04"), 2222);
  assert.equal(stepsFromBandData({ data: [] }, "2026-09-04"), 0);
});

test("regionHostFromLogin uses login mapping and otherwise the upload host", () => {
  assert.equal(regionHostFromLogin({}), "https://api-mifit-cn.huami.com");
  assert.equal(
    regionHostFromLogin({ domains: { "api-mifit.huami.com": "api-mifit-cn.huami.com" } }),
    "https://api-mifit-cn.huami.com",
  );
});

test("rate limiter blocks the sixth call", () => {
  const check = createLimiter(new Map(), { limit: 5, windowMs: 60_000 });
  const now = 1_000;
  for (let i = 0; i < 5; i += 1) assert.equal(check("ip", now).ok, true);
  assert.equal(check("ip", now).ok, false);
  assert.equal(check("ip", now + 61_000).ok, true);
});

function mockFetch(plan) {
  return async (url, options = {}) => {
    const item = plan.shift();
    assert.ok(item, `unexpected fetch ${url}`);
    if (item.expectUrl) assert.match(String(url), item.expectUrl);
    if (item.expectMethod) assert.equal(options.method, item.expectMethod);
    if (item.expectHeader) {
      for (const [key, value] of Object.entries(item.expectHeader)) {
        assert.equal(options.headers[key], value);
      }
    }
    return new Response(item.body ?? null, {
      status: item.status,
      headers: item.headers || { "content-type": "application/json" },
    });
  };
}

function memoryCache() {
  const store = new Map();
  const keyOf = (req) => (typeof req === "string" ? req : req.url);
  return {
    async match(req) {
      const hit = store.get(keyOf(req));
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(keyOf(req), res.clone());
    },
    async delete(req) {
      return store.delete(keyOf(req));
    },
  };
}

function huamiReadPlan(steps, date = todayBeijing()) {
  const summary = Buffer.from(JSON.stringify({ stp: { ttl: steps } }), "utf8").toString("base64");
  return [
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "app-token", user_id: "u1" } }),
    },
    {
      expectUrl: /api-mifit-cn\.huami\.com\/v1\/data\/band_data\.json\?.*query_type=summary.*device_type=/,
      expectMethod: "GET",
      expectHeader: { apptoken: "app-token", appname: "com.xiaomi.hm.health" },
      status: 200,
      body: JSON.stringify({
        code: 1,
        message: "success",
        data: [{ date, summary }],
      }),
    },
  ];
}

async function read(res) {
  return { status: res.status, body: JSON.parse(await res.text()) };
}

test("guest handler rejects empty credentials", async () => {
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json" },
    body: JSON.stringify({ user: "", password: "" }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" });
  const payload = await read(res);
  assert.equal(payload.status, 400);
  assert.equal(payload.body.ok, false);
});

test("guest handler CORS preflight", async () => {
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "OPTIONS",
    headers: { Origin: "https://kedreamix.github.io" },
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io/mimotion" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kedreamix.github.io");
});

test("guest handler allows Pages origin when allowlist uses the full board URL", async () => {
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json" },
    body: JSON.stringify({ user: "", password: "" }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io/mimotion" });
  const payload = await read(res);
  assert.equal(payload.status, 400);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kedreamix.github.io");
});

test("guest handler mocked login and sync does not persist password", async () => {
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json" },
    body: JSON.stringify({ user: "13800138000", password: "guest-secret", min_step: 12000, max_step: 12000 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, fetchImpl);
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.ok, true);
  assert.equal(payload.body.step, 12000);
  assert.equal(payload.body.user.includes("guest-secret"), false);
  assert.equal(JSON.stringify(payload.body).includes("guest-secret"), false);
  assert.equal(payload.body.trace.length, 3);
  assert.equal(payload.body.trace[0].stage, "login");
  assert.equal(payload.body.trace[1].stage, "grant");
  assert.equal(payload.body.trace[2].stage, "upload");
});

test("guest handler accepts an exact step", async () => {
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-exact" },
    body: JSON.stringify({ user: "13800138000", password: "guest-secret", step: 98800 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, fetchImpl);
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.step, 98800);
});

test("guest handler maps Huami login 401 to a password error", async () => {
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?error=401&" },
    },
  ]);
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-401" },
    body: JSON.stringify({ user: "a@b.com", password: "wrong", step: 3000 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, fetchImpl);
  const payload = await read(res);
  assert.equal(payload.status, 400);
  assert.equal(payload.body.ok, false);
  assert.equal(payload.body.stage, "login");
  assert.match(payload.body.error, /请检查密码/);
  assert.equal(payload.body.received.user, maskUser("a@b.com"));
  assert.equal(payload.body.received.password_len, 5);
  assert.equal(JSON.stringify(payload.body).includes("wrong"), false);
});

test("guest handler writes audit log without the password", async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?error=401&" },
    },
  ]);
  try {
    await handleRequest(new Request("https://guest.test/guest-run", {
      method: "POST",
      headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-log" },
      body: JSON.stringify({ user: "a@b.com", password: "super-secret-pass", step: 3000 }),
    }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, fetchImpl);
  } finally {
    console.log = orig;
  }
  const dumped = lines.join("\n");
  assert.match(dumped, /"kind":"guest-run"/);
  assert.match(dumped, /"ok":false/);
  assert.match(dumped, /"password_len":17/);
  assert.equal(dumped.includes("super-secret-pass"), false);
});

test("guest stats count success and failure rates", async () => {
  resetStatsForTests();
  const okFetch = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-stat-ok" },
    body: JSON.stringify({ user: "a@b.com", password: "secret", step: 3000 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, okFetch);

  const failFetch = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?error=401&" },
    },
  ]);
  await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-stat-fail" },
    body: JSON.stringify({ user: "a@b.com", password: "wrong", step: 3000 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }, failFetch);

  const payload = await read(await handleRequest(new Request("https://guest.test/guest-stats", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.api, "v1.0");
  assert.equal(payload.body.stats.ok, 1);
  assert.equal(payload.body.stats.fail, 1);
  assert.equal(payload.body.stats.total, 2);
  assert.equal(payload.body.stats.success_rate, 50);
});

test("guest handler returns huami-wait when Huami never answers", async () => {
  const fetchImpl = () => new Promise(() => {});
  const res = await handleRequest(new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "guest-deadline" },
    body: JSON.stringify({ user: "13800138000", password: "guest-secret", step: 3000 }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io", GUEST_DEADLINE_MS: 40 }, fetchImpl);
  const payload = await read(res);
  assert.equal(payload.status, 400);
  assert.equal(payload.body.ok, false);
  assert.equal(payload.body.stage, "huami-wait");
  assert.match(payload.body.error, /20 秒|没跑完/);
});

test("safeEqual rejects mismatched passwords", () => {
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "wrong"), false);
  assert.equal(safeEqual("secret", ""), false);
});

function ownerEnv(extra = {}) {
  return {
    ALLOWED_ORIGINS: "https://kedreamix.github.io",
    OWNER_PASSWORD: "secret",
    ...extra,
  };
}

function ownerRequest(body, ip = "owner-test") {
  return new Request("https://guest.test/owner-run", {
    method: "POST",
    headers: {
      Origin: "https://kedreamix.github.io",
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

test("owner-status reports whether worker secrets are configured", async () => {
  const missing = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" }));
  assert.equal(missing.status, 200);
  assert.equal(missing.body.configured, false);
  assert.equal(missing.body.hasPassword, false);

  const pwdOnly = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), ownerEnv()));
  assert.equal(pwdOnly.body.configured, true);
  assert.equal(pwdOnly.body.hasPassword, true);
  assert.equal(pwdOnly.body.hasAccount, false);
  assert.equal(pwdOnly.body.hasConfig, false);
  assert.equal(JSON.stringify(pwdOnly.body).includes("secret"), false);

  const ready = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), ownerEnv({ USER: "a@b.com", PWD: "zepp-secret" })));
  assert.equal(ready.body.configured, true);
  assert.equal(ready.body.hasAccount, true);
  assert.equal(JSON.stringify(ready.body).includes("zepp-secret"), false);
});

test("owner-run returns 503 when owner password secret is missing", async () => {
  const res = await handleRequest(ownerRequest({ password: "secret" }, "ip-missing"), {
    ALLOWED_ORIGINS: "https://kedreamix.github.io",
  });
  const payload = await read(res);
  assert.equal(payload.status, 503);
  assert.equal(payload.body.ok, false);
});

test("owner-run returns 401 for wrong password", async () => {
  const res = await handleRequest(
    ownerRequest({ password: "wrong" }, "ip-wrong"),
    ownerEnv({ CONFIG: JSON.stringify({ USER: "a@b.com", PWD: "zepp" }) }),
  );
  const payload = await read(res);
  assert.equal(payload.status, 401);
  assert.match(payload.body.error, /密码/);
});

test("owner-run returns 503 when USER/PWD are missing after password check", async () => {
  const res = await handleRequest(ownerRequest({ password: "secret" }, "ip-no-config"), ownerEnv());
  const payload = await read(res);
  assert.equal(payload.status, 503);
  assert.match(payload.body.error, /CONFIG|USER|PWD|账号/);
});

test("owner-run syncs via Huami using Worker USER/PWD, not GitHub Actions", async () => {
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  const res = await handleRequest(
    ownerRequest({ password: "secret", step: 12000 }, "ip-owner-ok"),
    ownerEnv({ USER: "13800138000", PWD: "zepp-secret" }),
    fetchImpl,
  );
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.ok, true);
  assert.equal(payload.body.step, 12000);
  assert.match(payload.body.message, /同步 12000 步/);
  assert.equal(JSON.stringify(payload.body).includes("zepp-secret"), false);
  assert.equal(JSON.stringify(payload.body).includes("secret"), false);
});

test("owner-run still accepts a slim CONFIG JSON as fallback", async () => {
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  const res = await handleRequest(
    ownerRequest({ password: "secret", step: 8000 }, "ip-owner-config"),
    ownerEnv({ CONFIG: JSON.stringify({ USER: "a@b.com", PWD: "zepp-secret" }) }),
    fetchImpl,
  );
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.step, 8000);
});

test("owner-run returns 503 when CONFIG JSON is invalid", async () => {
  const res = await handleRequest(
    ownerRequest({ password: "secret" }, "ip-bad-config"),
    ownerEnv({ CONFIG: "USER=not-json" }),
  );
  const payload = await read(res);
  assert.equal(payload.status, 503);
  assert.match(payload.body.error, /JSON/);
});

const oauthEnv = {
  ALLOWED_ORIGINS: "https://kedreamix.github.io/mimotion",
  GITHUB_CLIENT_ID: "client123",
  GITHUB_CLIENT_SECRET: "super-secret",
  OAUTH_REDIRECT_URI: "https://kedreamix.github.io/mimotion/",
};

test("oauth login redirects to GitHub authorize", async () => {
  const res = await handleRequest(new Request("https://guest.test/oauth/login?state=abc"), oauthEnv);
  assert.equal(res.status, 302);
  const location = res.headers.get("Location");
  assert.match(location, /github\.com\/login\/oauth\/authorize/);
  assert.match(location, /client_id=client123/);
  assert.match(location, /state=abc/);
  assert.match(location, /kedreamix\.github\.io/);
});

test("oauth token returns 503 when oauth is not configured", async () => {
  const res = await handleRequest(new Request("https://guest.test/oauth/token", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "ip-oauth-503" },
    body: JSON.stringify({ code: "x", redirect_uri: "https://kedreamix.github.io/mimotion/" }),
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io/mimotion" });
  const payload = await read(res);
  assert.equal(payload.status, 503);
});

test("oauth token exchanges code and does not leak client secret", async () => {
  const fetchImpl = async (url, options = {}) => {
    assert.match(String(url), /login\/oauth\/access_token/);
    const sent = JSON.parse(options.body);
    assert.equal(sent.client_id, "client123");
    assert.equal(sent.client_secret, "super-secret");
    return new Response(JSON.stringify({ access_token: "gho_test_token", token_type: "bearer" }), {
      headers: { "content-type": "application/json" },
    });
  };
  const res = await handleRequest(new Request("https://guest.test/oauth/token", {
    method: "POST",
    headers: { Origin: "https://kedreamix.github.io", "content-type": "application/json", "CF-Connecting-IP": "ip-oauth-ok" },
    body: JSON.stringify({ code: "code-1", redirect_uri: "https://kedreamix.github.io/mimotion/" }),
  }), oauthEnv, fetchImpl);
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.token, "gho_test_token");
  assert.equal(JSON.stringify(payload.body).includes("super-secret"), false);
});

function todayStepsRequest(query = "") {
  return new Request(`https://guest.test/today-steps${query}`, {
    headers: { Origin: "https://kedreamix.github.io" },
  });
}

test("GET /today-steps returns 503 without CONFIG", async () => {
  const payload = await read(await handleRequest(todayStepsRequest(), {
    ALLOWED_ORIGINS: "https://kedreamix.github.io",
  }));
  assert.equal(payload.status, 503);
  assert.equal(payload.body.ok, false);
  assert.equal(JSON.stringify(payload.body).includes("secret"), false);
});

test("GET /today-steps reads Huami summary, caches, and honors fresh=1", async () => {
  const cache = memoryCache();
  const env = ownerEnv({ USER: "a@b.com", PWD: "zepp-secret" });
  const first = await read(await handleRequest(
    todayStepsRequest(),
    env,
    mockFetch(huamiReadPlan(54188)),
    { cache },
  ));
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.steps, 54188);
  assert.equal(first.body.source, "huami");
  assert.equal(first.body.date, todayBeijing());
  assert.equal(JSON.stringify(first.body).includes("zepp-secret"), false);

  const cached = await read(await handleRequest(
    todayStepsRequest(),
    env,
    mockFetch([]),
    { cache },
  ));
  assert.equal(cached.status, 200);
  assert.equal(cached.body.steps, 54188);

  const fresh = await read(await handleRequest(
    todayStepsRequest("?fresh=1"),
    env,
    mockFetch(huamiReadPlan(999)),
    { cache },
  ));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.steps, 999);
});

test("GET /today-steps stays on the CN upload host even if login maps another region", async () => {
  const payload = await read(await handleRequest(
    todayStepsRequest(),
    ownerEnv({ USER: "a@b.com", PWD: "zepp" }),
    mockFetch([
      {
        expectUrl: /api-user\.zepp\.com/,
        expectMethod: "POST",
        status: 303,
        headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
      },
      {
        expectUrl: /account\.huami\.com/,
        expectMethod: "POST",
        status: 200,
        body: JSON.stringify({
          result: "ok",
          token_info: { login_token: "l", app_token: "app-token", user_id: "u1" },
          domains: { "api-mifit.huami.com": "api-mifit-de.huami.com" },
        }),
      },
      {
        expectUrl: /api-mifit-cn\.huami\.com\/v1\/data\/band_data\.json\?.*device_type=android_phone/,
        expectMethod: "GET",
        status: 200,
        body: JSON.stringify({
          code: 1,
          message: "success",
          data: [{ date: todayBeijing(), summary: JSON.stringify({ stp: { ttl: 321 } }) }],
        }),
      },
    ]),
  ));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.steps, 321);
});

test("GET /today-steps retries summary with device_type=0 if android_phone returns 400", async () => {
  const payload = await read(await handleRequest(
    todayStepsRequest(),
    ownerEnv({ USER: "a@b.com", PWD: "zepp" }),
    mockFetch([
      {
        expectUrl: /api-user\.zepp\.com/,
        expectMethod: "POST",
        status: 303,
        headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
      },
      {
        expectUrl: /account\.huami\.com/,
        expectMethod: "POST",
        status: 200,
        body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "app-token", user_id: "u1" } }),
      },
      {
        expectUrl: /device_type=android_phone/,
        expectMethod: "GET",
        status: 400,
        body: JSON.stringify({ code: 0, message: "invalid device" }),
      },
      {
        expectUrl: /device_type=0/,
        expectMethod: "GET",
        status: 200,
        body: JSON.stringify({
          code: 1,
          message: "success",
          data: [{ date: todayBeijing(), summary: JSON.stringify({ stp: { ttl: 777 } }) }],
        }),
      },
    ]),
  ));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.steps, 777);
});

test("GET /today-steps CORS matches other public GET routes", async () => {
  const res = await handleRequest(todayStepsRequest(), ownerEnv({ USER: "a@b.com", PWD: "zepp" }), mockFetch(huamiReadPlan(12)));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kedreamix.github.io");
  const payload = await read(res);
  assert.equal(payload.body.steps, 12);
});

test("owner-run updates today-steps cache", async () => {
  const cache = memoryCache();
  await cache.put(TODAY_STEPS_CACHE_URL, new Response(JSON.stringify({
    ok: true,
    date: todayBeijing(),
    steps: 100,
    source: "huami",
  }), {
    headers: { "content-type": "application/json", "Cache-Control": "public, max-age=180" },
  }));
  const fetchImpl = mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
  const res = await handleRequest(
    ownerRequest({ password: "secret", step: 12000 }, "ip-owner-cache"),
    ownerEnv({ USER: "13800138000", PWD: "zepp-secret" }),
    fetchImpl,
    { cache },
  );
  const payload = await read(res);
  assert.equal(payload.status, 200);
  const hit = await cache.match(TODAY_STEPS_CACHE_URL);
  const cached = JSON.parse(await hit.text());
  assert.equal(cached.ok, true);
  assert.equal(cached.steps, 12000);
  assert.equal(cached.source, "huami");
  assert.equal(cached.date, todayBeijing());
});

function memoryD1() {
  const rows = [];
  let nextId = 1;
  function query(sql, args) {
    const kind = args[0] || "guest";
    const filtered = rows.filter((row) => row.kind === kind);
    if (/COUNT\(DISTINCT/i.test(sql) || /unique_users/i.test(sql)) {
      const users = new Set(filtered.map((row) => row.user));
      const okCount = filtered.filter((row) => Number(row.ok) === 1).length;
      return [{
        total: filtered.length,
        unique_users: users.size,
        ok_count: okCount,
        fail_count: filtered.length - okCount,
      }];
    }
    if (/ORDER BY/i.test(sql)) {
      const limit = Number(args[1]) || 20;
      return [...filtered].sort((a, b) => b.id - a.id).slice(0, limit);
    }
    return filtered;
  }
  return {
    rows,
    async exec() {
      return { count: 2 };
    },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (/INSERT\s+INTO\s+guest_runs/i.test(sql)) {
                const [created_at, user, ok, step, stage, error, elapsed_ms, kind] = args;
                rows.push({
                  id: nextId++,
                  created_at,
                  user,
                  ok,
                  step,
                  stage,
                  error,
                  elapsed_ms,
                  kind,
                });
              }
              return { success: true };
            },
            async all() {
              return { results: query(sql, args) };
            },
            async first() {
              return query(sql, args)[0] || null;
            },
          };
        },
      };
    },
  };
}

function memoryAE() {
  const points = [];
  return {
    points,
    writeDataPoint(point) {
      points.push({
        blobs: [...(point.blobs || [])],
        doubles: [...(point.doubles || [])],
        indexes: [...(point.indexes || [])],
      });
    },
  };
}

function waitCtx() {
  const pending = [];
  return {
    pending,
    waitUntil(task) {
      pending.push(Promise.resolve(task));
    },
    async flush() {
      await Promise.all(pending.splice(0));
    },
  };
}

function guestSuccessFetch() {
  return mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?access=tok123&" },
    },
    {
      expectUrl: /account\.huami\.com/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ result: "ok", token_info: { login_token: "l", app_token: "a", user_id: "u1" } }),
    },
    {
      expectUrl: /band_data\.json/,
      expectMethod: "POST",
      status: 200,
      body: JSON.stringify({ message: "success" }),
    },
  ]);
}

function guestFailFetch() {
  return mockFetch([
    {
      expectUrl: /api-user\.zepp\.com/,
      expectMethod: "POST",
      status: 303,
      headers: { Location: "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html?error=401&" },
    },
  ]);
}

function guestRunRequest(body, ip = "guest-usage") {
  return new Request("https://guest.test/guest-run", {
    method: "POST",
    headers: {
      Origin: "https://kedreamix.github.io",
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

test("hasD1 / hasAnalytics detect bindings without throwing", () => {
  assert.equal(hasD1({}), false);
  assert.equal(hasAnalytics({}), false);
  assert.equal(hasD1({ DB: memoryD1() }), true);
  assert.equal(hasAnalytics({ USAGE: memoryAE() }), true);
});

test("sanitizeError never keeps the password", () => {
  assert.equal(sanitizeError("boom secret-pass", ["secret-pass"]), "boom [已隐藏]");
  assert.match(sanitizeError("pwd=super-secret-pass"), /已隐藏/);
  assert.equal(sanitizeError("pwd=super-secret-pass").includes("super-secret-pass"), false);
});

test("usageRow stores plaintext account and drops password", () => {
  const row = usageRow({
    user: "13800138000",
    password: "guest-secret",
    ok: true,
    step: 12000,
    stage: "done",
    elapsed_ms: 42,
    kind: "guest",
  });
  assert.equal(row.user, "13800138000");
  assert.equal(row.ok, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "password"), false);
  assert.equal(JSON.stringify(row).includes("guest-secret"), false);
});

test("guest-run still 200 when D1 and Analytics Engine bindings are missing", async () => {
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "13800138000", password: "guest-secret", step: 12000 }, "guest-no-bind"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io" },
    guestSuccessFetch(),
  ));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.ok, true);
  assert.equal(JSON.stringify(payload.body).includes("guest-secret"), false);
});

test("guest-run writes D1 and Analytics Engine on success without storing password", async () => {
  const db = memoryD1();
  const ae = memoryAE();
  const ctx = waitCtx();
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "13800138000", password: "guest-secret", step: 12000 }, "guest-d1-ok"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io", DB: db, USAGE: ae },
    guestSuccessFetch(),
    ctx,
  ));
  assert.equal(payload.status, 200);
  assert.ok(ctx.pending.length >= 1);
  await ctx.flush();
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].user, "+8613800138000");
  assert.equal(db.rows[0].ok, 1);
  assert.equal(db.rows[0].step, 12000);
  assert.equal(db.rows[0].kind, "guest");
  assert.equal(Object.prototype.hasOwnProperty.call(db.rows[0], "password"), false);
  assert.equal(JSON.stringify(db.rows[0]).includes("guest-secret"), false);
  assert.equal(JSON.stringify(payload.body).includes("guest-secret"), false);
  assert.equal(ae.points.length, 1);
  assert.deepEqual(ae.points[0].blobs.slice(0, 3), ["guest", "+8613800138000", "ok"]);
  assert.equal(ae.points[0].indexes[0], "guest");
  assert.equal(JSON.stringify(ae.points).includes("guest-secret"), false);
});

test("guest-run writes D1 and Analytics Engine on Huami failure", async () => {
  const db = memoryD1();
  const ae = memoryAE();
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "a@b.com", password: "wrong-pass", step: 3000 }, "guest-d1-fail"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io", DB: db, USAGE: ae },
    guestFailFetch(),
  ));
  assert.equal(payload.status, 400);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].user, "a@b.com");
  assert.equal(db.rows[0].ok, 0);
  assert.equal(db.rows[0].stage, "login");
  assert.equal(JSON.stringify(db.rows[0]).includes("wrong-pass"), false);
  assert.equal(ae.points[0].blobs[2], "fail");
});

test("empty password guest-run does not write usage", async () => {
  const db = memoryD1();
  const ae = memoryAE();
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "a@b.com", password: "  ", step: 3000 }, "guest-empty-pwd"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io", DB: db, USAGE: ae },
  ));
  assert.equal(payload.status, 400);
  assert.equal(db.rows.length, 0);
  assert.equal(ae.points.length, 0);
});

test("guest-run still 200 if D1 insert throws", async () => {
  const ae = memoryAE();
  const db = {
    async exec() {
      throw new Error("d1 down");
    },
    prepare() {
      throw new Error("d1 down");
    },
  };
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "13800138000", password: "guest-secret", step: 8000 }, "guest-d1-throw"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io", DB: db, USAGE: ae },
    guestSuccessFetch(),
  ));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.ok, true);
  assert.equal(ae.points.length, 1);
});

test("guest-run uses waitUntil so D1 does not block the Huami response", async () => {
  let resolveInsert;
  const insertGate = new Promise((resolve) => {
    resolveInsert = resolve;
  });
  const db = {
    async exec() {},
    prepare() {
      return {
        bind() {
          return {
            run: () => insertGate,
          };
        },
      };
    },
  };
  const ctx = waitCtx();
  const started = Date.now();
  const payload = await read(await handleRequest(
    guestRunRequest({ user: "13800138000", password: "guest-secret", step: 5000 }, "guest-waituntil"),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io", DB: db },
    guestSuccessFetch(),
    ctx,
  ));
  assert.ok(Date.now() - started < 200);
  assert.equal(payload.status, 200);
  assert.ok(ctx.pending.length >= 1);
  resolveInsert({ success: true });
  await ctx.flush();
});

function usageRequest(method, extra = {}) {
  const url = method === "GET"
    ? `https://guest.test/owner-usage?password=${encodeURIComponent(extra.password || "")}&limit=${extra.limit || 20}`
    : "https://guest.test/owner-usage";
  return new Request(url, {
    method,
    headers: {
      Origin: "https://kedreamix.github.io",
      "content-type": "application/json",
      "CF-Connecting-IP": extra.ip || "owner-usage",
    },
    body: method === "POST" ? JSON.stringify({ password: extra.password, limit: extra.limit }) : undefined,
  });
}

test("owner-usage returns 503 when OWNER_PASSWORD is missing", async () => {
  const payload = await read(await handleRequest(
    usageRequest("POST", { password: "secret", ip: "usage-no-secret" }),
    { ALLOWED_ORIGINS: "https://kedreamix.github.io" },
  ));
  assert.equal(payload.status, 503);
  assert.equal(payload.body.ok, false);
});

test("owner-usage returns 401 for wrong password", async () => {
  const payload = await read(await handleRequest(
    usageRequest("POST", { password: "wrong", ip: "usage-401" }),
    ownerEnv({ DB: memoryD1() }),
  ));
  assert.equal(payload.status, 401);
  assert.match(payload.body.error, /密码/);
  assert.equal(JSON.stringify(payload.body).includes("secret"), false);
});

test("owner-usage returns 503 when D1 is not bound", async () => {
  const payload = await read(await handleRequest(
    usageRequest("POST", { password: "secret", ip: "usage-no-d1" }),
    ownerEnv(),
  ));
  assert.equal(payload.status, 503);
  assert.match(payload.body.error, /D1/);
  assert.equal(payload.body.hasD1, false);
});

test("owner-status reports hasD1 and hasAnalytics when bindings exist", async () => {
  const payload = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), ownerEnv({ DB: memoryD1(), USAGE: memoryAE() })));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.hasD1, true);
  assert.equal(payload.body.hasAnalytics, true);
  assert.equal(JSON.stringify(payload.body).includes("secret"), false);
});

test("GET and POST /owner-usage return unique users and recent plaintext accounts", async () => {
  const db = memoryD1();
  const env = ownerEnv({ DB: db, USAGE: memoryAE() });
  await handleRequest(
    guestRunRequest({ user: "a@b.com", password: "one-secret", step: 3000 }, "usage-a"),
    env,
    guestSuccessFetch(),
  );
  await handleRequest(
    guestRunRequest({ user: "13800138000", password: "two-secret", step: 4000 }, "usage-b"),
    env,
    guestSuccessFetch(),
  );
  await handleRequest(
    guestRunRequest({ user: "a@b.com", password: "bad-secret", step: 4000 }, "usage-c"),
    env,
    guestFailFetch(),
  );

  const posted = await read(await handleRequest(
    usageRequest("POST", { password: "secret", limit: 10, ip: "usage-post" }),
    env,
  ));
  assert.equal(posted.status, 200);
  assert.equal(posted.body.ok, true);
  assert.equal(posted.body.unique_users, 2);
  assert.equal(posted.body.total, 3);
  assert.equal(posted.body.ok_count, 2);
  assert.equal(posted.body.fail_count, 1);
  assert.equal(posted.body.recent[0].user, "a@b.com");
  assert.equal(posted.body.recent.some((row) => row.user === "+8613800138000"), true);
  assert.equal(JSON.stringify(posted.body).includes("secret"), false);
  assert.equal(JSON.stringify(posted.body).includes("one-secret"), false);
  assert.equal(JSON.stringify(posted.body).includes("two-secret"), false);
  assert.equal(JSON.stringify(posted.body).includes("bad-secret"), false);
  assert.equal(posted.body.recent.every((row) => !("password" in row)), true);

  const gotten = await read(await handleRequest(
    usageRequest("GET", { password: "secret", limit: 10, ip: "usage-get" }),
    env,
  ));
  assert.equal(gotten.status, 200);
  assert.equal(gotten.body.unique_users, 2);
  assert.equal(gotten.body.hasD1, true);
});

test("owner-run records kind=owner without Zepp password or owner password", async () => {
  const db = memoryD1();
  const ae = memoryAE();
  const payload = await read(await handleRequest(
    ownerRequest({ password: "secret", step: 9000 }, "owner-usage-row"),
    ownerEnv({ USER: "owner@x.com", PWD: "zepp-secret", DB: db, USAGE: ae }),
    guestSuccessFetch(),
  ));
  assert.equal(payload.status, 200);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].kind, "owner");
  assert.equal(db.rows[0].user.includes("@"), false);
  assert.match(db.rows[0].user, /\*\*\*\*/);
  assert.equal(JSON.stringify(db.rows[0]).includes("zepp-secret"), false);
  assert.equal(JSON.stringify(db.rows[0]).includes("secret"), false);
  assert.equal(ae.points[0].indexes[0], "owner");
});
