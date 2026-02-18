CREATE INDEX IF NOT EXISTS idx_stations_provider ON stations(provider);
CREATE INDEX IF NOT EXISTS idx_stations_updated_at ON stations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_latest_snapshot_time ON latest(snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_hash_snapshot ON usage(hash_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_usage_snapshot_time ON usage(snapshot_time DESC);
