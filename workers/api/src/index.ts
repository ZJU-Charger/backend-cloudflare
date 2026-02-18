import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  epochMsToIso,
  isValidDevid,
  isValidHashId,
  isValidProvider,
  parseDeviceIds,
} from "../../shared/src";
import type { FormattedStationStatus } from "../../shared/src";

interface Env {
  DB: D1Database;
  API_RATE_LIMITER?: RateLimit;
}

type Bindings = { Bindings: Env };

interface LatestRow {
  hash_id: string;
  snapshot_time: number;
  free: number;
  used: number;
  total: number;
  error: number;
}

interface StationRow {
  hash_id: string;
  name: string;
  provider: string;
  campus_id: number | null;
  campus_name: string | null;
  lat: number | null;
  lon: number | null;
  device_ids_json: string | null;
  updated_at: number;
}

const app = new Hono<Bindings>();
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

app.use("*", cors({ origin: "*" }));

app.use("/api/*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const limiter = c.env.API_RATE_LIMITER;
  if (!limiter) {
    await next();
    return;
  }

  const clientIp = c.req.header("cf-connecting-ip")?.trim();
  const key = `${clientIp && clientIp.length > 0 ? clientIp : "unknown"}:${c.req.path}`;
  const outcome = await limiter.limit({ key });

  if (!outcome.success) {
    return c.json(
      { detail: "请求过于频繁，请稍后再试" },
      429,
      { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) },
    );
  }

  await next();
});

app.get("/api", (c) => {
  return c.json({
    message: "ZJU Charger API",
    version: "1.0.0",
    endpoints: {
      "GET /api/status": "实时查询所有站点（支持 ?provider=neptune 参数筛选，支持 ?id=xxx 查询指定站点）",
      "GET /api/providers": "返回可用服务商列表",
      "GET /api/stations": "返回站点基础信息（id、名称、坐标、服务商）",
    },
  });
});

app.get("/api/providers", async (c) => {
  try {
    const stmt = c.env.DB.prepare("SELECT DISTINCT provider FROM stations ORDER BY provider ASC");
    const result = await stmt.all<{ provider: string }>();
    const providers = (result.results ?? [])
      .map((row) => row.provider)
      .filter((provider): provider is string => Boolean(provider))
      .map((provider) => ({ id: provider, name: provider }));

    return c.json(providers);
  } catch (error) {
    console.error("Failed to load providers", error);
    return c.json({ detail: "获取服务商列表失败" }, 500);
  }
});

app.get("/api/stations", async (c) => {
  try {
    const rows = await selectAllStations(c.env.DB);
    if (rows.length === 0) {
      return c.json({ detail: "站点信息不可用" }, 503);
    }

    const updatedAt = maxStationUpdatedAt(rows);

    return c.json({
      updated_at: epochMsToIso(updatedAt) ?? new Date().toISOString(),
      stations: rows.map((row) => ({
        id: row.hash_id,
        name: row.name,
        devdescript: row.name,
        provider: row.provider,
        campus_id: row.campus_id,
        campus_name: row.campus_name,
        latitude: row.lat,
        longitude: row.lon,
        devids: parseDeviceIds(row.device_ids_json),
      })),
    });
  } catch (error) {
    console.error("Failed to load stations", error);
    return c.json({ detail: "站点信息不可用" }, 503);
  }
});

app.get("/api/status", async (c) => {
  const provider = c.req.query("provider");
  const hashId = c.req.query("hash_id");
  const devid = c.req.query("devid");

  const validationError = validateStatusQuery({ provider, hashId, devid });
  if (validationError) {
    return c.json({ detail: validationError.message }, validationError.status);
  }

  try {
    const rows = await selectLatestRows(c.env.DB, hashId);
    const hasFilter = Boolean(provider || hashId || devid);

    if (rows.length === 0) {
      if (hasFilter) {
        return c.json({ detail: "未找到匹配站点或设备" }, 404);
      }
      return c.json({ detail: "站点状态暂不可用" }, 503);
    }

    const metadataMap = await selectStationMetadataByIds(c.env.DB, rows.map((row) => row.hash_id), provider);
    const stations = buildStatusStations(rows, metadataMap, provider, devid);

    if (stations.length === 0) {
      if (hasFilter) {
        return c.json({ detail: "未找到匹配站点或设备" }, 404);
      }
      return c.json({ detail: "站点状态暂不可用" }, 503);
    }

    const updatedAt = maxSnapshotTime(rows);

    return c.json({
      updated_at: epochMsToIso(updatedAt) ?? new Date().toISOString(),
      stations,
    });
  } catch (error) {
    console.error("Failed to query status", error);
    return c.json({ detail: "查询站点失败" }, 500);
  }
});

function validateStatusQuery(input: {
  provider?: string;
  hashId?: string;
  devid?: string;
}): { status: 400 | 422; message: string } | null {
  const { provider, hashId, devid } = input;

  if (provider && !isValidProvider(provider)) {
    return {
      status: 422,
      message: "provider 参数格式错误，只允许字母、数字、下划线和连字符",
    };
  }

  if (hashId && !isValidHashId(hashId)) {
    return {
      status: 422,
      message: "hash_id 参数格式错误，必须是 8 位十六进制字符串",
    };
  }

  if (devid && !isValidDevid(devid)) {
    return {
      status: 422,
      message: "devid 参数格式错误",
    };
  }

  if (devid && !provider) {
    return {
      status: 400,
      message: "查询 devid 时必须同时提供 provider 参数",
    };
  }

  return null;
}

async function selectAllStations(db: D1Database): Promise<StationRow[]> {
  const stmt = db.prepare(
    "SELECT hash_id, name, provider, campus_id, campus_name, lat, lon, device_ids_json, updated_at FROM stations ORDER BY provider ASC, name ASC",
  );
  const result = await stmt.all<StationRow>();
  return result.results ?? [];
}

async function selectLatestRows(db: D1Database, hashId?: string): Promise<LatestRow[]> {
  if (hashId) {
    const stmt = db.prepare(
      "SELECT hash_id, snapshot_time, free, used, total, error FROM latest WHERE hash_id = ?1",
    );
    const result = await stmt.bind(hashId).all<LatestRow>();
    return result.results ?? [];
  }

  const stmt = db.prepare("SELECT hash_id, snapshot_time, free, used, total, error FROM latest");
  const result = await stmt.all<LatestRow>();
  return result.results ?? [];
}

async function selectStationMetadataByIds(
  db: D1Database,
  hashIds: string[],
  provider?: string,
): Promise<Map<string, StationRow>> {
  const uniqueHashIds = [...new Set(hashIds.filter(Boolean))];
  if (uniqueHashIds.length === 0) {
    return new Map();
  }

  const placeholders = uniqueHashIds.map(() => "?").join(",");
  const sql = provider
    ? `SELECT hash_id, name, provider, campus_id, campus_name, lat, lon, device_ids_json, updated_at FROM stations WHERE hash_id IN (${placeholders}) AND provider = ? ORDER BY name ASC`
    : `SELECT hash_id, name, provider, campus_id, campus_name, lat, lon, device_ids_json, updated_at FROM stations WHERE hash_id IN (${placeholders}) ORDER BY name ASC`;

  const values = provider ? [...uniqueHashIds, provider] : uniqueHashIds;
  const result = await db.prepare(sql).bind(...values).all<StationRow>();

  const map = new Map<string, StationRow>();
  for (const row of result.results ?? []) {
    map.set(row.hash_id, row);
  }
  return map;
}

function buildStatusStations(
  latestRows: LatestRow[],
  metadataMap: Map<string, StationRow>,
  provider?: string,
  devid?: string,
): FormattedStationStatus[] {
  const seen = new Set<string>();
  const stations: FormattedStationStatus[] = [];

  for (const row of latestRows) {
    if (seen.has(row.hash_id)) {
      continue;
    }

    const metadata = metadataMap.get(row.hash_id);
    if (provider && !metadata) {
      continue;
    }

    const deviceIds = parseDeviceIds(metadata?.device_ids_json ?? []);
    if (devid && !deviceIds.includes(String(devid))) {
      continue;
    }

    stations.push({
      hash_id: row.hash_id,
      id: row.hash_id,
      name: metadata?.name ?? row.hash_id,
      provider: metadata?.provider ?? null,
      campus_id: metadata?.campus_id ?? null,
      campus_name: metadata?.campus_name ?? null,
      lat: metadata?.lat ?? null,
      lon: metadata?.lon ?? null,
      devids: deviceIds,
      free: Number(row.free ?? 0),
      used: Number(row.used ?? 0),
      total: Number(row.total ?? 0),
      error: Number(row.error ?? 0),
    });

    seen.add(row.hash_id);
  }

  return stations;
}

function maxSnapshotTime(rows: LatestRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.snapshot_time ?? 0)), 0);
}

function maxStationUpdatedAt(rows: StationRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.updated_at ?? 0)), 0);
}

export default app;
