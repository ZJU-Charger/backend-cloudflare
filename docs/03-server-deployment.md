# Cloudflare Workers 部署指南

本项目后端已迁移为 Cloudflare 原生架构：

- `workers/api`：Hono API Worker（只读 D1）
- `workers/fetcher`：Cron Fetcher Worker（抓取 + 写入 D1）
- `workers/d1/migrations`：D1 schema 与索引

## 1. 前置条件

- Cloudflare 账号
- 已安装 Node.js 20+ 与 pnpm
- 已安装 Wrangler（项目内依赖已包含）

```bash
pnpm install
```

## 1.1 GitHub Actions 自动部署

仓库内置 `.github/workflows/workers-deploy.yml`，推送 `main` 后自动执行：

1. `workers:typecheck`
2. 远程执行 D1 migrations
3. 部署 API Worker
4. 部署 Fetcher Worker

只需在 GitHub 仓库设置以下 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 2. 创建 D1 数据库

```bash
pnpm --dir workers/api wrangler d1 create zju-charger
```

记录返回的 `database_id`，然后分别更新：

- `workers/api/wrangler.toml`
- `workers/fetcher/wrangler.toml`

中的 `database_id` 字段。

## 3. 执行 D1 迁移

```bash
pnpm --dir workers/api wrangler d1 execute zju-charger --file ../d1/migrations/0001_init.sql
pnpm --dir workers/api wrangler d1 execute zju-charger --file ../d1/migrations/0002_indexes.sql
```

## 4. 配置 Fetcher Secrets

`workers/fetcher` 依赖服务商令牌，按需注入：

```bash
pnpm --dir workers/fetcher wrangler secret put NEPTUNE_JUNIOR_OPENID
pnpm --dir workers/fetcher wrangler secret put NEPTUNE_JUNIOR_UNIONID
pnpm --dir workers/fetcher wrangler secret put DLMM_TOKEN
pnpm --dir workers/fetcher wrangler secret put ELSE_PROVIDER_OPENTOOL_TOKEN
pnpm --dir workers/fetcher wrangler secret put ELSE_PROVIDER_LETFUNGO_TOKEN
pnpm --dir workers/fetcher wrangler secret put ELSE_PROVIDER_WANCHONG_TOKEN
pnpm --dir workers/fetcher wrangler secret put ELSE_PROVIDER_WKD_TOKEN
```

## 5. 本地开发

```bash
pnpm run api:dev
pnpm run fetcher:dev
```

- API 默认可通过本地 wrangler 地址访问（含 `/api/*`）
- 可手动触发抓取：`POST /run` 到 fetcher worker

## 6. 部署顺序（生产）

1. 部署 `fetcher-worker`
2. 观察 D1 是否持续写入 `latest/usage`
3. 部署 `api-worker`
4. 将前端 `NEXT_PUBLIC_API_BASE` 切换到 API Worker 域名

```bash
pnpm run fetcher:deploy
pnpm run api:deploy
```

## 7. 夜间暂停窗口

Fetcher 默认在 UTC+8 `00:10 - 05:50` 跳过抓取，与旧行为保持一致。

## 8. 回滚建议

若 API 切换后异常：

1. 先回滚前端 `NEXT_PUBLIC_API_BASE`
2. 暂停 fetcher cron
3. 保留 D1 数据用于排障
