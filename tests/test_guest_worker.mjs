import assert from "node:assert/strict";
import test from "node:test";
import { encryptHuami } from "../worker/src/aes.js";
import { handleRequest } from "../worker/src/index.js";
import { safeEqual } from "../worker/src/secret.js";
import { resetStatsForTests } from "../worker/src/stats.js";
import { applyBandTemplate, clampStep, describeLoginError, formBody, maskUser, normalizeUser, stepRangeByTime } from "../worker/src/zepp.js";
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
    return new Response(item.body ?? null, {
      status: item.status,
      headers: item.headers || { "content-type": "application/json" },
    });
  };
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
  assert.equal(pwdOnly.body.hasConfig, false);
  assert.equal(JSON.stringify(pwdOnly.body).includes("secret"), false);

  const ready = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), ownerEnv({ CONFIG: JSON.stringify({ USER: "a@b.com", PWD: "zepp-secret" }) })));
  assert.equal(ready.body.configured, true);
  assert.equal(ready.body.hasConfig, true);
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

test("owner-run returns 503 when CONFIG is missing after password check", async () => {
  const res = await handleRequest(ownerRequest({ password: "secret" }, "ip-no-config"), ownerEnv());
  const payload = await read(res);
  assert.equal(payload.status, 503);
  assert.match(payload.body.error, /CONFIG/);
});

test("owner-run syncs via Huami using Worker CONFIG, not GitHub Actions", async () => {
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
  const config = JSON.stringify({ USER: "13800138000", PWD: "zepp-secret", MIN_STEP: "12000", MAX_STEP: "12000" });
  const res = await handleRequest(
    ownerRequest({ password: "secret", step: 12000 }, "ip-owner-ok"),
    ownerEnv({ CONFIG: config }),
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
