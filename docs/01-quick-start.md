# 快速开始

本项目后端已迁移到 Cloudflare Workers + D1。

## 1. 安装依赖

```bash
pnpm install
```

## 2. 创建 D1 并绑定

```bash
pnpm --dir workers/api wrangler d1 create zju-charger
```

把返回的 `database_id` 写入：

- `workers/api/wrangler.toml`
- `workers/fetcher/wrangler.toml`

## 3. 初始化数据库

```bash
pnpm --dir workers/api wrangler d1 execute zju-charger --file ../d1/migrations/0001_init.sql
pnpm --dir workers/api wrangler d1 execute zju-charger --file ../d1/migrations/0002_indexes.sql
```

## 4. 配置 fetcher secrets（按需）

```bash
pnpm --dir workers/fetcher wrangler secret put NEPTUNE_JUNIOR_OPENID
pnpm --dir workers/fetcher wrangler secret put NEPTUNE_JUNIOR_UNIONID
pnpm --dir workers/fetcher wrangler secret put DLMM_TOKEN
```

## 5. 本地运行

```bash
pnpm run api:dev
pnpm run fetcher:dev
```

## 6. 本地验证

```bash
curl http://127.0.0.1:8787/api/providers
curl http://127.0.0.1:8787/api/stations
curl http://127.0.0.1:8787/api/status
```

## 7. 部署

```bash
pnpm run fetcher:deploy
pnpm run api:deploy
```
