# mimotion-guest

游客刷步接口。接收一次 Zepp Life 账号密码，登录并提交步数后丢弃凭证。

```bash
npx wrangler deploy
```

生产环境把 `docs/guest-config.js` 里的 Worker 地址改成部署结果。本地：

```bash
node worker/dev-server.mjs
```
