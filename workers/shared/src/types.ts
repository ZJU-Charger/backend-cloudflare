export interface StationMetadata {
  hashId: string;
  name: string;
  provider: string;
  campusId: number;
  campusName: string;
  lat: number;
  lon: number;
  deviceIds: string[];
}

export interface StationSnapshot {
  hashId: string;
  snapshotTime: number;
  free: number;
  used: number;
  total: number;
  error: number;
}

export interface FormattedStationStatus {
  hash_id: string;
  id: string;
  name: string;
  provider: string | null;
  campus_id: number | null;
  campus_name: string | null;
  lat: number | null;
  lon: number | null;
  devids: string[];
  free: number;
  used: number;
  total: number;
  error: number;
}
