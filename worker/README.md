# mimotion Worker

游客刷步，以及站长用独立密码刷自己的账号。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。 Cloudflare 控制台里的 Worker 名叫 `mimotion`。

公开 `GET /today-steps` 用 Worker Secret `CONFIG` 登录华米，读当天 `stp.ttl`。每次请求都现问华米；成功后把当前步数记到 D1（表 `owner_today_steps`）和 Cache API。看板打开时读 `GET /last-steps` 显示上次记下的数，**不**自动问华米。点右上角「刷新」才打 `/today-steps`。`POST /owner-run` 成功后也会记下刚上传的步数。改完代码后需要重新部署 Worker。

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

用量收集：

- **D1**（表 `guest_runs`）记明文账号、成败、步数。看板用站长密码点「查看用量」。
- **Analytics Engine**（dataset `mimotion_usage`）记次数和成败，适合看趋势。

控制台操作：

1. **D1**：已写入 `wrangler.toml`（库名 `mimotion`，绑定 `DB`）。控制台建库后绑到 Worker `mimotion`，Variable name 必须是 `DB`。
2. **Analytics Engine**：Worker `mimotion` → Settings → Bindings → Add → Analytics Engine，Variable name `USAGE`，dataset `mimotion_usage`。没有单独「新建库」页。

没绑定时迈步照常工作，只是不记账。密码不会写入 D1。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

本地：

```bash
OWNER_PASSWORD=demo CONFIG='{"USER":"a@b.com","PWD":"x"}' node worker/dev-server.mjs
```
