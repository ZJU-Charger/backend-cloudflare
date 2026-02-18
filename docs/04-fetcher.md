# Fetcher Worker 说明

`workers/fetcher` 是 Cloudflare Cron Worker，每 2 分钟执行一次抓取并写入 D1。

## 行为

- 触发：`*/2 * * * *`
- 夜间暂停：UTC+8 `00:10 - 05:50`
- 站点来源：运行时从 D1 `stations` 表加载（每轮仅查询一次）
- 写入表：`latest`、`usage`
- 错误处理：单站点失败不会中断整轮任务
- 子请求保护：遇到 `Too many subrequests` 会保留本轮已成功抓取结果并提前结束

## 站点数据维护

站点元数据由 `stations` 表维护。需要改站点时，直接改库即可，下个周期自动生效。

推荐字段：`hash_id`、`provider`、`name`、`campus_id`、`campus_name`、`lat`、`lon`、`device_ids_json`。

## 手动触发

本地或远程可通过 fetcher 的 `POST /run` 手动触发一轮抓取。

## 历史写入开关

`workers/fetcher/wrangler.toml` 默认：

```toml
[vars]
HISTORY_ENABLED = "true"
```

设置为 `false` 时，仅更新 `latest`。

## 开发与部署

```bash
pnpm run fetcher:dev
pnpm run fetcher:typecheck
pnpm run fetcher:deploy
```
