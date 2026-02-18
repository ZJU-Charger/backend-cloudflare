# <img src="assets/logo_white.png" alt="logo" width="30"> ZJU Charger

浙江大学充电桩查询助手。

前端已部署在 Cloudflare Pages；本仓库维护 Cloudflare 原生后端：

- API Worker（Hono）
- Fetcher Worker（Cron）
- D1（SQLite）

## 架构

```mermaid
flowchart TD
    A[Frontend / Cloudflare Pages] --> B[API Worker / Hono]
    B --> C[D1]
    D[Fetcher Worker / Cron] --> C
```

## API（保持不变）

- `GET /api`
- `GET /api/providers`
- `GET /api/stations`
- `GET /api/status`

## 目录结构

```text
workers/
├── api/                     # Hono API Worker
├── fetcher/                 # Cron Fetcher Worker（每轮从 D1 读取 stations）
├── shared/                  # 共享类型与工具
└── d1/migrations/           # D1 schema/index SQL
```

## 本地开发

```bash
pnpm install
pnpm run api:dev
pnpm run fetcher:dev
pnpm run lint
```

## 部署

```bash
pnpm run fetcher:deploy
pnpm run api:deploy
```

## 文档

- [快速开始](./docs/01-quick-start.md)
- [Cloudflare Workers 部署](./docs/03-server-deployment.md)
- [Fetcher Worker 文档](./docs/04-fetcher.md)
- [D1 数据结构](./docs/07-d1-schema.md)
- [API 参考](./docs/08-api.md)

## 许可证

GPLv3，见 [LICENSE](./LICENSE)。
