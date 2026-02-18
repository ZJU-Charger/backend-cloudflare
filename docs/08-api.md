# API 参考指南

> 旧版 `/api/web` 已淘汰，统一使用下列 REST 接口。

## GET `/api`

返回 API 元信息。

```bash
curl https://<your-api-worker-domain>/api
```

## GET `/api/providers`

返回服务商列表：

```json
[{ "id": "neptune", "name": "neptune" }]
```

```bash
curl https://<your-api-worker-domain>/api/providers
```

## GET `/api/stations`

返回站点元数据（用于补全地图/列表）：

```bash
curl https://<your-api-worker-domain>/api/stations
```

## GET `/api/status`

返回实时状态（来自 D1 `latest` 表）：

- `provider`：按服务商过滤
- `hash_id`：按 8 位十六进制站点 ID 过滤
- `devid`：必须配合 `provider` 使用

```bash
curl https://<your-api-worker-domain>/api/status
curl "https://<your-api-worker-domain>/api/status?provider=neptune"
curl "https://<your-api-worker-domain>/api/status?hash_id=3e262917"
curl "https://<your-api-worker-domain>/api/status?provider=neptune&devid=8120"
```

错误语义：

- `400`：`devid` 缺少 `provider`
- `404`：过滤条件无匹配
- `422`：参数格式非法
- `503`：`latest` 无可用数据

## 钉钉 Webhook

本轮迁移未包含 `/ding/*`；相关能力后续独立迁移。
