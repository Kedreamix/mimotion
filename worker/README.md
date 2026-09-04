# mimotion Worker

游客刷步，以及站长用独立密码刷自己的账号。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。 Cloudflare 控制台里的 Worker 名叫 `mimotion`。

```bash
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put CONFIG
```

`OWNER_PASSWORD` 是看板上的站长密码，**不要**写进 GitHub Variables、`params.json` 或网页。

`CONFIG` 可以和仓库 GitHub Secret 那份 JSON 相同。Worker 只用里面的 `USER` / `PWD`（以及可选的步数范围），**不会**发 PushPlus / 企业微信 / Telegram。GitHub `PAT` **不要**放到 Worker。定时任务继续读仓库 Secret。

`keep_vars = true`，之后部署不会冲掉密钥。

Cloudflare 控制台路径：Workers & Pages → `mimotion` → Settings → Variables and Secrets。

迈步提交日志：Workers & Pages → `mimotion` → Observability / Logs。仓库已打开 `[observability] enabled = true`。合入带 `console.log` 的版本后，可以搜 `guest-run`，看到脱敏账号、密码位数、断在哪一步。密码不会进日志。实时跟也可以 `npx wrangler tail`。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

本地：

```bash
OWNER_PASSWORD=demo CONFIG='{"USER":"a@b.com","PWD":"x"}' node worker/dev-server.mjs
```
