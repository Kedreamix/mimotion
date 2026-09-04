# mimotion Worker

游客刷步，以及站长用独立密码刷自己的账号。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。 Cloudflare 控制台里的 Worker 名叫 `mimotion`。

```bash
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put PAT
```

`OWNER_PASSWORD` 是看板上的站长密码，**不要**写进 GitHub Variables、`params.json` 或网页。

`PAT` **不用新申请**：把仓库 Settings → Secrets → Actions 里已有的 `PAT` 复制到 Worker。Cloudflare 读不到 GitHub 密钥。密码验证通过后 Worker 用它触发 `workflow_dispatch`，Zepp 账号仍从仓库 `CONFIG` 读。

可选：`OWNER_REPO`（默认 `Kedreamix/mimotion`，如果你 fork 后改了仓库名才需要改）。

Cloudflare 控制台路径：Workers & Pages → `mimotion` → Settings → Variables and Secrets。

迈步提交日志：Workers & Pages → `mimotion` → Observability / Logs。仓库已打开 `[observability] enabled = true`。合入带 `console.log` 的版本后，可以搜 `guest-run`，看到脱敏账号、密码位数、断在哪一步。密码不会进日志。实时跟也可以 `npx wrangler tail`。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

本地：

```bash
OWNER_PASSWORD=demo PAT=github_pat_xxx OWNER_REPO=yourname/mimotion node worker/dev-server.mjs
```
