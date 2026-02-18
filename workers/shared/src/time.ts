export const UTC8_OFFSET_HOURS = 8;

export function epochMsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return new Date(value).toISOString();
}

export function isNightPauseWindow(now: Date = new Date()): boolean {
  const hour = (now.getUTCHours() + UTC8_OFFSET_HOURS) % 24;
  const minute = now.getUTCMinutes();

  if (hour === 0) {
    return minute >= 10;
  }

  if (hour > 0 && hour < 5) {
    return true;
  }

  if (hour === 5) {
    return minute <= 50;
  }

  return false;
}
