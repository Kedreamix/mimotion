import assert from "node:assert/strict";
import test from "node:test";
import { encryptHuami } from "../worker/src/aes.js";
import { handleRequest } from "../worker/src/index.js";
import { safeEqual } from "../worker/src/secret.js";
import { applyBandTemplate, clampStep, maskUser, normalizeUser, stepRangeByTime } from "../worker/src/zepp.js";
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
  assert.equal(normalizeUser("a@b.com"), "a@b.com");
  assert.equal(maskUser("+8613800138000"), "+86****8000");
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
  assert.equal(pwdOnly.body.hasPat, false);
  assert.equal(JSON.stringify(pwdOnly.body).includes("secret"), false);

  const ready = await read(await handleRequest(new Request("https://guest.test/owner-status", {
    headers: { Origin: "https://kedreamix.github.io" },
  }), ownerEnv({ PAT: "github_pat_test" })));
  assert.equal(ready.body.configured, true);
  assert.equal(ready.body.hasPat, true);
  assert.equal(JSON.stringify(ready.body).includes("github_pat_test"), false);
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
    ownerEnv({ PAT: "github_pat_test" }),
  );
  const payload = await read(res);
  assert.equal(payload.status, 401);
  assert.match(payload.body.error, /密码/);
});

test("owner-run returns 503 when PAT is missing after password check", async () => {
  const res = await handleRequest(ownerRequest({ password: "secret" }, "ip-no-pat"), ownerEnv());
  const payload = await read(res);
  assert.equal(payload.status, 503);
  assert.match(payload.body.error, /配置完成/);
});

test("owner-run triggers workflow_dispatch via GitHub API", async () => {
  let dispatched = null;
  const fetchImpl = async (url, options = {}) => {
    dispatched = { url: String(url), options };
    return new Response(null, { status: 204 });
  };
  const res = await handleRequest(
    ownerRequest({ password: "secret", min_step: 12000, max_step: 15000 }, "ip-owner-ok"),
    ownerEnv({ PAT: "github_pat_test", OWNER_REPO: "TestOwner/mimotion" }),
    fetchImpl,
  );
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.equal(payload.body.ok, true);
  assert.match(dispatched.url, /TestOwner\/mimotion\/actions\/workflows\/run\.yml\/dispatches/);
  assert.match(dispatched.options.headers.Authorization, /github_pat_test/);
  const sentBody = JSON.parse(dispatched.options.body);
  assert.equal(sentBody.ref, "master");
  assert.equal(sentBody.inputs.min_step, "12000");
  assert.equal(sentBody.inputs.max_step, "15000");
  assert.equal(JSON.stringify(payload.body).includes("github_pat_test"), false);
});

test("owner-run accepts OWNER_GITHUB_PAT as an alias for PAT", async () => {
  let dispatched = null;
  const fetchImpl = async (url, options = {}) => {
    dispatched = { url: String(url), options };
    return new Response(null, { status: 204 });
  };
  const res = await handleRequest(
    ownerRequest({ password: "secret" }, "ip-owner-alias"),
    ownerEnv({ OWNER_GITHUB_PAT: "github_pat_alias", OWNER_REPO: "TestOwner/mimotion" }),
    fetchImpl,
  );
  const payload = await read(res);
  assert.equal(payload.status, 200);
  assert.match(dispatched.options.headers.Authorization, /github_pat_alias/);
});

test("owner-run returns 400 when GitHub API rejects dispatch", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ message: "Resource not accessible by token" }),
    { status: 422, headers: { "content-type": "application/json" } },
  );
  const res = await handleRequest(
    ownerRequest({ password: "secret" }, "ip-owner-err"),
    ownerEnv({ PAT: "github_pat_bad", OWNER_REPO: "TestOwner/mimotion" }),
    fetchImpl,
  );
  const payload = await read(res);
  assert.equal(payload.status, 400);
  assert.match(payload.body.error, /Resource not accessible/);
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
