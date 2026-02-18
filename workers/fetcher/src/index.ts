import { isNightPauseWindow, parseDeviceIds } from "../../shared/src";

interface Env {
  DB: D1Database;
  HISTORY_ENABLED?: string;
  FETCH_CONCURRENCY?: string;
  NEPTUNE_JUNIOR_OPENID?: string;
  NEPTUNE_JUNIOR_UNIONID?: string;
  DLMM_TOKEN?: string;
  ELSE_PROVIDER_OPENTOOL_TOKEN?: string;
  ELSE_PROVIDER_LETFUNGO_TOKEN?: string;
  ELSE_PROVIDER_WANCHONG_TOKEN?: string;
  ELSE_PROVIDER_WKD_TOKEN?: string;
}

interface StationSeed {
  hashId: string;
  name: string;
  provider: string;
  campusId: number;
  campusName: string;
  lat: number;
  lon: number;
  deviceIds: string[];
}

interface StationRow {
  hash_id: string;
  name: string | null;
  provider: string | null;
  campus_id: number | null;
  campus_name: string | null;
  lat: number | null;
  lon: number | null;
  device_ids_json: string | null;
}

interface StationSnapshot {
  hashId: string;
  snapshotTime: number;
  free: number;
  used: number;
  total: number;
  error: number;
}

interface NeptuneJuniorRunContext {
  token: string | null;
  tokenPromise: Promise<string | null> | null;
  attempted: boolean;
}

const FETCH_TIMEOUT_MS = 8_000;
const CRON_INTERVAL_MS = 2 * 60 * 1000;
const SNAPSHOT_UPSERT_CHUNK_SIZE = 16;
const DEFAULT_FETCH_CONCURRENCY = 4;
const MAX_FETCH_CONCURRENCY = 6;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run" && request.method === "POST") {
      await runScheduledFetch(env);
      return jsonResponse({ success: true, message: "Fetcher run completed" });
    }

    return jsonResponse({
      success: true,
      service: "zju-charger-fetcher",
      message: "Use cron trigger or POST /run to execute fetch cycle.",
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runScheduledFetch(env);
  },
};

async function runScheduledFetch(env: Env): Promise<void> {
  if (isNightPauseWindow(new Date())) {
    console.log("Skip scheduled fetch in UTC+8 night pause window (00:10-05:50).");
    return;
  }

  const startedAt = Date.now();
  const stations = await loadAllStations(env.DB);

  if (stations.length === 0) {
    console.warn("No stations loaded from database.");
    return;
  }

  const snapshotTime = Date.now();
  const stationsForRun = rotateStationsForCycle(stations, snapshotTime);
  const neptuneJuniorContext: NeptuneJuniorRunContext = { token: null, tokenPromise: null, attempted: false };
  const fetchConcurrency = resolveFetchConcurrency(env.FETCH_CONCURRENCY);
  const { snapshots, stoppedBySubrequestLimit } = await fetchStationsWithConcurrency(
    stationsForRun,
    env,
    neptuneJuniorContext,
    snapshotTime,
    fetchConcurrency,
  );

  if (snapshots.length === 0) {
    console.warn("No successful snapshots collected in this cycle; skip database write.");
    return;
  }

  // Write after the whole fetch cycle is complete, minimizing round-trips.
  await upsertLatest(env.DB, snapshots);

  if (isHistoryEnabled(env.HISTORY_ENABLED)) {
    await upsertUsage(env.DB, snapshots);
  }

  console.log(
    JSON.stringify({
      event: "fetch_cycle_complete",
      stationCount: stations.length,
      fetchedStationCount: snapshots.length,
      fetchConcurrency,
      durationMs: Date.now() - startedAt,
      historyEnabled: isHistoryEnabled(env.HISTORY_ENABLED),
      stoppedBySubrequestLimit,
    }),
  );
}

async function loadAllStations(db: D1Database): Promise<StationSeed[]> {
  const result = await db
    .prepare(
      "SELECT hash_id, name, provider, campus_id, campus_name, lat, lon, device_ids_json FROM stations ORDER BY provider ASC, name ASC",
    )
    .all<StationRow>();

  return (result.results ?? [])
    .map((row) => {
      const hashId = String(row.hash_id ?? "").trim();
      const name = String(row.name ?? "").trim();
      const provider = String(row.provider ?? "").trim();

      if (!hashId || !name || !provider) {
        return null;
      }

      return {
        hashId,
        name,
        provider,
        campusId: safeNumber(row.campus_id),
        campusName: String(row.campus_name ?? "").trim(),
        lat: Number(row.lat ?? 0),
        lon: Number(row.lon ?? 0),
        deviceIds: parseDeviceIds(row.device_ids_json),
      } satisfies StationSeed;
    })
    .filter((station): station is StationSeed => station !== null);
}

async function fetchStationUsage(
  station: StationSeed,
  env: Env,
  neptuneJuniorContext: NeptuneJuniorRunContext,
): Promise<{ free: number; used: number; total: number; error: number }> {
  switch (station.provider) {
    case "neptune":
      return fetchNeptuneUsage(station);
    case "neptune_junior":
      return fetchNeptuneJuniorUsage(station, env, neptuneJuniorContext);
    case "dlmm":
      return fetchDlmmUsage(station, env);
    case "专用站点":
    case "待补充":
    case "河狸物联":
      return { free: 0, used: 0, total: 0, error: 0 };
    default:
      return fetchElseProviderUsage(station, env);
  }
}

async function fetchStationsWithConcurrency(
  stations: StationSeed[],
  env: Env,
  neptuneJuniorContext: NeptuneJuniorRunContext,
  snapshotTime: number,
  concurrency: number,
): Promise<{ snapshots: StationSnapshot[]; stoppedBySubrequestLimit: boolean }> {
  if (stations.length === 0) {
    return { snapshots: [], stoppedBySubrequestLimit: false };
  }

  const snapshotByIndex: Array<StationSnapshot | null> = new Array(stations.length).fill(null);
  let cursor = 0;
  let stoppedBySubrequestLimit = false;

  async function worker(): Promise<void> {
    while (!stoppedBySubrequestLimit) {
      const index = cursor;
      cursor += 1;

      if (index >= stations.length) {
        return;
      }

      const station = stations[index];
      try {
        const usage = await fetchStationUsage(station, env, neptuneJuniorContext);
        snapshotByIndex[index] = {
          hashId: station.hashId,
          snapshotTime,
          free: usage.free,
          used: usage.used,
          total: usage.total,
          error: usage.error,
        };
      } catch (error) {
        if (isTooManySubrequestsError(error)) {
          stoppedBySubrequestLimit = true;
          console.warn("Subrequest limit reached; persisting partial successful snapshots only.");
          return;
        }
        console.error(`Station fetch failed for ${station.provider}/${station.name}`, error);
      }
    }
  }

  const workerCount = Math.min(concurrency, stations.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    snapshots: snapshotByIndex.filter((item): item is StationSnapshot => item !== null),
    stoppedBySubrequestLimit,
  };
}

async function fetchNeptuneUsage(station: StationSeed) {
  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const payload = new URLSearchParams({
      areaId: "6",
      devaddress: deviceId,
    });

    const response = await fetchJson<{
      success?: boolean;
      obj?: { devaddress?: string | number; portstatur?: string };
      msg?: string;
    }>("http://www.szlzxn.cn/wxn/getDeviceInfo", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });

    if (!response || response.success !== true || !response.obj) {
      console.warn(`Neptune device fetch failed for ${deviceId}`);
      continue;
    }

    const portStatus = String(response.obj.portstatur ?? "");
    if (!portStatus) {
      continue;
    }

    free += countChar(portStatus, "0");
    used += countChar(portStatus, "1");
    error += countChar(portStatus, "3");
    total += portStatus.length;
  }

  return { free, used, total, error };
}

async function fetchNeptuneJuniorUsage(
  station: StationSeed,
  env: Env,
  context: NeptuneJuniorRunContext,
) {
  const token = await ensureNeptuneJuniorToken(env, context);
  if (!token) {
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      data?: {
        totalPileNumber?: number;
        totalFreeNumber?: number;
        totalTroubleNumber?: number;
        totalBookingNumber?: number;
        totalUpgradeNumber?: number;
      };
    }>(
      `https://gateway.hzxwwl.com/api/charging/pile/listChargingPileDistByArea?chargingAreaId=${encodeURIComponent(deviceId)}`,
      {
        method: "GET",
        headers: {
          "REQ-NPD-TOKEN": token,
        },
      },
    );

    const data = response?.data;
    if (!data) {
      continue;
    }

    const currentTotal = safeNumber(data.totalPileNumber);
    const currentFree = safeNumber(data.totalFreeNumber);
    const currentError = safeNumber(data.totalTroubleNumber);
    const currentBooking = safeNumber(data.totalBookingNumber);
    const currentUpgrade = safeNumber(data.totalUpgradeNumber);
    const currentUsed = Math.max(0, currentTotal - currentFree - currentError - currentBooking - currentUpgrade);

    total += currentTotal;
    free += currentFree;
    used += currentUsed;
    error += currentError;
  }

  return { free, used, total, error };
}

async function ensureNeptuneJuniorToken(env: Env, context: NeptuneJuniorRunContext): Promise<string | null> {
  if (context.token) {
    return context.token;
  }

  if (context.tokenPromise) {
    return context.tokenPromise;
  }

  if (context.attempted) {
    return null;
  }

  context.attempted = true;

  const openid = env.NEPTUNE_JUNIOR_OPENID;
  const unionid = env.NEPTUNE_JUNIOR_UNIONID;

  if (!openid || !unionid) {
    console.warn("Missing NEPTUNE_JUNIOR_OPENID/NEPTUNE_JUNIOR_UNIONID secret values.");
    return null;
  }

  context.tokenPromise = (async () => {
    const response = await fetchJson<{ data?: { token?: string } }>(
      `https://gateway.hzxwwl.com/api/auth/wx/mp?openid=${encodeURIComponent(openid)}&unionid=${encodeURIComponent(unionid)}`,
      { method: "GET" },
    );

    const token = response?.data?.token?.trim();
    if (!token) {
      console.warn("Failed to obtain Neptune Junior token.");
      return null;
    }

    context.token = token;
    return token;
  })();

  const token = await context.tokenPromise;
  context.tokenPromise = null;
  return token;
}

async function fetchDlmmUsage(station: StationSeed, env: Env) {
  const token = env.DLMM_TOKEN;
  if (!token) {
    console.warn("Missing DLMM_TOKEN secret value.");
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      code?: number;
      data?: { socketArray?: Array<{ status?: number }> };
    }>("https://dlmmplususer.dianlvmama.com/dlServer/dlmm/getStation", {
      method: "POST",
      headers: {
        authorization: token,
        "tenant-id": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ stationNo: deviceId }),
    });

    if (!response || response.code !== 200) {
      console.warn(`Dlmm device fetch failed for ${deviceId}`);
      continue;
    }

    const socketArray = response.data?.socketArray ?? [];
    for (const socket of socketArray) {
      const status = safeNumber(socket?.status);
      total += 1;
      if (status === 0) {
        free += 1;
      } else if (status === 1) {
        used += 1;
      } else {
        error += 1;
      }
    }
  }

  return { free, used, total, error };
}

async function fetchElseProviderUsage(station: StationSeed, env: Env) {
  switch (station.provider) {
    case "万充科技":
      return fetchWanchongUsage(station, env);
    case "点点畅行":
      return fetchDiandianUsage(station);
    case "电动车充电网":
      return fetchLetfungoUsage(station, env);
    case "多航科技":
      return fetchDuohangUsage(station, env);
    case "威可迪换电":
      return fetchWkdUsage(station, env);
    case "嘟嘟换电":
      return fetchDuduUsage(station);
    default:
      return { free: 0, used: 0, total: 0, error: 0 };
  }
}

async function fetchWanchongUsage(station: StationSeed, env: Env) {
  const token = env.ELSE_PROVIDER_WANCHONG_TOKEN;
  if (!token) {
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      data?: { port?: Array<{ state?: number }> };
    }>(`https://websocket.wanzhuangkj.com/query?company_id=29&device_num=${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: {
        authorization: token,
      },
    });

    const ports = response?.data?.port ?? [];
    for (const port of ports) {
      const state = safeNumber(port?.state);
      total += 1;
      if (state === 0) {
        free += 1;
      } else if (state === 2) {
        used += 1;
      } else {
        error += 1;
      }
    }
  }

  return { free, used, total, error };
}

async function fetchDiandianUsage(station: StationSeed) {
  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      data?: { DeviceWays?: Array<{ State?: number }> };
    }>("https://api2.hzchaoxiang.cn/api-device/api/v1/scan/Index", {
      method: "POST",
      body: new URLSearchParams({ DeviceNumber: deviceId }),
    });

    const ways = response?.data?.DeviceWays ?? [];
    for (const way of ways) {
      const state = safeNumber(way?.State);
      total += 1;
      if (state === 2) {
        free += 1;
      } else if (state === 1) {
        used += 1;
      } else {
        error += 1;
      }
    }
  }

  return { free, used, total, error };
}

async function fetchLetfungoUsage(station: StationSeed, env: Env) {
  const token = env.ELSE_PROVIDER_LETFUNGO_TOKEN;
  if (!token) {
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      data?: { charger_false?: number; charger_true?: number };
    }>(
      `https://app.letfungo.com/api/cabinet/getSiteDetail2?siteId=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(token)}`,
      { method: "POST" },
    );

    const chargerFree = safeNumber(response?.data?.charger_true);
    const chargerUsed = safeNumber(response?.data?.charger_false);

    free += chargerFree;
    used += chargerUsed;
  }

  return { free, used, total: free + used, error: 0 };
}

async function fetchDuohangUsage(station: StationSeed, env: Env) {
  const token = env.ELSE_PROVIDER_OPENTOOL_TOKEN;
  if (!token) {
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const body = {
      sn: `GD1B${deviceId}`,
      _sn: `GD1B${deviceId}`,
      is_check: 0,
      new_rule: 1,
    };

    const response = await fetchJson<{
      data?: {
        port_list?: Array<{ status_text?: string }>;
      };
    }>("https://mini.opencool.top/api/device.device/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        token,
      },
      body: JSON.stringify(body),
    });

    const ports = response?.data?.port_list ?? [];
    for (const port of ports) {
      total += 1;
      const statusText = String(port?.status_text ?? "");
      if (statusText === "空闲") {
        free += 1;
      } else if (statusText === "使用中") {
        used += 1;
      } else {
        error += 1;
      }
    }
  }

  return { free, used, total, error };
}

async function fetchWkdUsage(station: StationSeed, env: Env) {
  const token = env.ELSE_PROVIDER_WKD_TOKEN;
  if (!token) {
    return { free: 0, used: 0, total: 0, error: 0 };
  }

  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      data?: {
        cabinetDeviceList?: Array<{
          detailBatteryList?: Array<{
            onlineStatus?: unknown;
            changeFlag?: string;
          }>;
        }>;
      };
    }>(
      "https://gateway.wkdsz.com/ce-battery-account/app/cabinetDevice/getCabinetDeviceDoorById",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "header-secretkey": token,
        },
        body: JSON.stringify({ id: deviceId }),
      },
    );

    const batteries = response?.data?.cabinetDeviceList?.[0]?.detailBatteryList ?? [];
    for (const battery of batteries) {
      total += 1;
      if (battery?.onlineStatus == null) {
        error += 1;
      } else if (battery?.changeFlag !== "Y") {
        used += 1;
      } else {
        free += 1;
      }
    }
  }

  return { free, used, total, error };
}

async function fetchDuduUsage(station: StationSeed) {
  let free = 0;
  let used = 0;
  let total = 0;
  let error = 0;

  for (const deviceId of station.deviceIds) {
    const response = await fetchJson<{
      code?: number;
      data?: {
        storeTake?: number;
        cbExchangeVOList?: Array<{
          cbExchangeUploadVO?: {
            storeNull?: number;
            storeLowPowerBatteryCharge?: number;
            storeSoftLock?: number;
            storeCount?: number;
          };
        }>;
      };
    }>(
      `https://api.dudugxcd.com/sharing-citybike-consumer/site/v2/map/info?id=${encodeURIComponent(deviceId)}`,
      {
        method: "GET",
        headers: {
          oem_code: "citybike",
        },
      },
    );

    if (!response || response.code !== 200) {
      continue;
    }

    free += safeNumber(response.data?.storeTake);

    const exchangeList = response.data?.cbExchangeVOList ?? [];
    for (const exchange of exchangeList) {
      const upload = exchange.cbExchangeUploadVO;
      used += safeNumber(upload?.storeNull);
      error += safeNumber(upload?.storeLowPowerBatteryCharge) + safeNumber(upload?.storeSoftLock);
      total += safeNumber(upload?.storeCount);
    }
  }

  return { free, used, total, error };
}

async function upsertLatest(db: D1Database, snapshots: StationSnapshot[]): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  for (const chunk of chunkArray(snapshots, SNAPSHOT_UPSERT_CHUNK_SIZE)) {
    const values: Array<string | number> = [];
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?)")
      .join(", ");

    for (const snapshot of chunk) {
      values.push(
        snapshot.hashId,
        snapshot.snapshotTime,
        snapshot.free,
        snapshot.used,
        snapshot.total,
        snapshot.error,
      );
    }

    await db
      .prepare(
        `INSERT INTO latest (hash_id, snapshot_time, free, used, total, error)
         VALUES ${placeholders}
         ON CONFLICT(hash_id) DO UPDATE SET
           snapshot_time = excluded.snapshot_time,
           free = excluded.free,
           used = excluded.used,
           total = excluded.total,
           error = excluded.error`,
      )
      .bind(...values)
      .run();
  }
}

async function upsertUsage(db: D1Database, snapshots: StationSnapshot[]): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  for (const chunk of chunkArray(snapshots, SNAPSHOT_UPSERT_CHUNK_SIZE)) {
    const values: Array<string | number> = [];
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?)")
      .join(", ");

    for (const snapshot of chunk) {
      values.push(
        snapshot.hashId,
        snapshot.snapshotTime,
        snapshot.free,
        snapshot.used,
        snapshot.total,
        snapshot.error,
      );
    }

    await db
      .prepare(
        `INSERT INTO usage (hash_id, snapshot_time, free, used, total, error)
         VALUES ${placeholders}
         ON CONFLICT(hash_id, snapshot_time) DO UPDATE SET
           free = excluded.free,
           used = excluded.used,
           total = excluded.total,
           error = excluded.error`,
      )
      .bind(...values)
      .run();
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function rotateStationsForCycle(stations: StationSeed[], nowMs: number): StationSeed[] {
  if (stations.length < 2) {
    return stations;
  }

  const cycle = Math.floor(nowMs / CRON_INTERVAL_MS);
  const offset = cycle % stations.length;
  if (offset === 0) {
    return stations;
  }

  return stations.slice(offset).concat(stations.slice(0, offset));
}

function isHistoryEnabled(value: string | undefined): boolean {
  return value == null || value.toLowerCase() !== "false";
}

function resolveFetchConcurrency(rawValue: string | undefined): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FETCH_CONCURRENCY;
  }
  return Math.min(parsed, MAX_FETCH_CONCURRENCY);
}

function safeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function countChar(input: string, target: string): number {
  let count = 0;
  for (const character of input) {
    if (character === target) {
      count += 1;
    }
  }
  return count;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("fetch-timeout"), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Non-2xx response from ${url}: ${response.status}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isTooManySubrequestsError(error)) {
      throw error;
    }
    console.warn(`Fetch failed for ${url}`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isTooManySubrequestsError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("too many subrequests");
  }
  if (typeof error === "string") {
    return error.toLowerCase().includes("too many subrequests");
  }
  return false;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
