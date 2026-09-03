# mimotion-guest

游客刷步，以及站长用独立密码刷自己的账号。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。

```bash
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put OWNER_USER
npx wrangler secret put OWNER_PWD
```

`OWNER_PASSWORD` 是看板上的站长密码，**不要**写进 GitHub Variables、`params.json` 或网页。`OWNER_USER` / `OWNER_PWD` 是你的 Zepp Life 账号。

Cloudflare 控制台路径：Workers & Pages → `mimotion-guest` → Settings → Variables and Secrets。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

本地：

```bash
OWNER_PASSWORD=demo OWNER_USER=13800138000 OWNER_PWD=secret node worker/dev-server.mjs
```
