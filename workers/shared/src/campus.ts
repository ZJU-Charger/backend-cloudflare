export const CAMPUS_NAME_MAP: Record<number, string> = {
  1: "玉泉校区",
  2: "紫金港校区",
  3: "华家池校区",
  4: "西溪校区",
  5: "之江校区",
};

export function resolveCampusName(campusId: number): string {
  return CAMPUS_NAME_MAP[campusId] ?? "";
}
