# mimotion-guest

可选的游客刷步接口。正式看板在 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)，站长马上刷步走 GitHub PAT，不依赖这个 Worker。

`ALLOWED_ORIGINS` 写成看板地址即可，例如 `https://kedreamix.github.io/mimotion`。浏览器 Origin 不含路径，Worker 会按站点 origin 放行。

本地：

```bash
node worker/dev-server.mjs
```
