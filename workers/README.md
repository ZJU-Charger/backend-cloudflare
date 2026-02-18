# Workers Backend

## Components

- `api/`: Hono API Worker (read-only D1)
- `fetcher/`: Scheduled fetcher Worker (`*/2 * * * *`)
- `shared/`: shared TypeScript utilities
- `d1/migrations/`: D1 SQL migrations

## Commands

```bash
pnpm run api:dev
pnpm run fetcher:dev
pnpm run workers:typecheck
pnpm run api:deploy
pnpm run fetcher:deploy
```

## Required bindings

Both workers require D1 binding `DB`.

## Fetcher secrets

- `NEPTUNE_JUNIOR_OPENID`
- `NEPTUNE_JUNIOR_UNIONID`
- `DLMM_TOKEN`
- `ELSE_PROVIDER_OPENTOOL_TOKEN`
- `ELSE_PROVIDER_LETFUNGO_TOKEN`
- `ELSE_PROVIDER_WANCHONG_TOKEN`
- `ELSE_PROVIDER_WKD_TOKEN`
