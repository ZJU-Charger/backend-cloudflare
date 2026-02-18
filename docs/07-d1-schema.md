# D1 数据库表结构（Cloudflare）

## 表模型

- `stations`：站点元数据
- `latest`：每站点最新快照
- `usage`：历史快照（可选关闭）

## 建表 SQL

```sql
CREATE TABLE IF NOT EXISTS stations (
  hash_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  campus_id INTEGER,
  campus_name TEXT,
  lat REAL,
  lon REAL,
  device_ids_json TEXT NOT NULL DEFAULT "[]",
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS latest (
  hash_id TEXT PRIMARY KEY,
  snapshot_time INTEGER NOT NULL,
  free INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  error INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(hash_id) REFERENCES stations(hash_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash_id TEXT NOT NULL,
  snapshot_time INTEGER NOT NULL,
  free INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  error INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(hash_id) REFERENCES stations(hash_id) ON DELETE CASCADE,
  UNIQUE(hash_id, snapshot_time)
);
```

## 索引

```sql
CREATE INDEX IF NOT EXISTS idx_stations_provider ON stations(provider);
CREATE INDEX IF NOT EXISTS idx_stations_updated_at ON stations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_latest_snapshot_time ON latest(snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_hash_snapshot ON usage(hash_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_snapshot_time ON usage(snapshot_time DESC);
```

## 字段约定

- 时间统一为 `INTEGER`（Unix epoch ms）
- `device_ids_json` 为 JSON 字符串数组
- `hash_id` 为全局站点主键（由站点维护流程保证唯一）

## 常用查询

最新全量：

```sql
SELECT hash_id, snapshot_time, free, used, total, error
FROM latest;
```

某站点历史：

```sql
SELECT hash_id, snapshot_time, free, used, total, error
FROM usage
WHERE hash_id = ?
ORDER BY snapshot_time DESC
LIMIT 100;
```
