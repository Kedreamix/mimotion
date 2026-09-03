# mimotion Worker

游客刷步，以及站长用独立密码刷自己的账号。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)。 Cloudflare 控制台里的 Worker 名叫 `mimotion`。

```bash
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put OWNER_GITHUB_PAT
```

`OWNER_PASSWORD` 是看板上的站长密码，**不要**写进 GitHub Variables、`params.json` 或网页。
`OWNER_GITHUB_PAT` 是一个 fine-grained token，只需要 **Actions: write** 权限——密码验证通过后 Worker 用它触发 `workflow_dispatch`，Zepp 账号还是从仓库 `CONFIG` 读，不用配两份。

可选：`OWNER_REPO`（默认 `Kedreamix/mimotion`，如果你 fork 后改了仓库名才需要改）。

Cloudflare 控制台路径：Workers & Pages → `mimotion` → Settings → Variables and Secrets。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。

本地：

```bash
OWNER_PASSWORD=demo OWNER_GITHUB_PAT=github_pat_xxx OWNER_REPO=yourname/mimotion node worker/dev-server.mjs
```
