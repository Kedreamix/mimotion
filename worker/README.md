# mimotion-guest

游客刷步，以及看板「用 GitHub 登录」的换票。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

GitHub 登录需要两个 Secret：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

OAuth 回调必须是 `https://kedreamix.github.io/mimotion/`。

本地：

```bash
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy OAUTH_REDIRECT_URI=http://127.0.0.1:8765/ node worker/dev-server.mjs
```
