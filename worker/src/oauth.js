export function pagesRedirectUri(env) {
  const raw = String(env.OAUTH_REDIRECT_URI || "https://kedreamix.github.io/mimotion/").trim();
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function oauthConfigured(env) {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function githubAuthorizeUrl(env, state) {
  const clientId = String(env.GITHUB_CLIENT_ID || "");
  if (!clientId) throw new Error("还没配置 GITHUB_CLIENT_ID");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", pagesRedirectUri(env));
  url.searchParams.set("scope", "public_repo");
  url.searchParams.set("state", String(state || ""));
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

function normalizeRedirect(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export async function exchangeGithubCode({ env, code, redirectUri, fetchImpl = fetch }) {
  if (!oauthConfigured(env)) throw new Error("还没配置 GitHub OAuth");
  if (!code) throw new Error("缺少授权码");
  const expected = pagesRedirectUri(env);
  if (normalizeRedirect(redirectUri) !== expected) {
    throw new Error("回调地址不匹配");
  }
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: expected,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub 换票失败");
  }
  return { token: data.access_token };
}
