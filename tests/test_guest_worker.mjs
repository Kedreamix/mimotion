import assert from "node:assert/strict";
import test from "node:test";
import { encryptHuami } from "../worker/src/aes.js";
import { handleRequest } from "../worker/src/index.js";
import { applyBandTemplate, maskUser, normalizeUser, stepRangeByTime } from "../worker/src/zepp.js";
import { createLimiter } from "../worker/src/rate-limit.js";

const PYTHON_PLAIN = "emailOrPhone=%2B8613800138000&password=secret&state=REDIRECTION&client_id=HuaMi&country_code=CN&token=access&redirect_uri=https%3A%2F%2Fs3-us-west-2.amazonaws.com%2Fhm-registration%2Fsuccesssignin.html";
const PYTHON_HEX = "c43c0bbec04ee1b3f430164f237ae2a2cb66e050c21445c97064dfdaea58f88f35ed5bc458f237ac3a50bb0d2af215a43f01bbf5ee9dbf6d160aa119f5291205d1050845114a29c568a5dcc4e6309766ab0223e28d6fab29c3671b7f4ad7cea1d1426b005f746728682c10ab37fc1990b8373eafb1ece7538a0d0c83ba0f4377466efc0d347d79f761aa965286a444e96ebcc96c3ad8049a5396e94ab76d9d17cb3dc9d2f2e91ec394c601ead6a863568365e0a0590e0057f1530d2c508f00542b1302eb44ab9ad00b42f838ef1529ec";

function hex(bytes) {
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
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
  }), { ALLOWED_ORIGINS: "https://kedreamix.github.io" });
  assert.equal(res.status, 204);
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
