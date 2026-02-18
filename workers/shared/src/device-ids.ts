export function parseDeviceIds(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0);
        }
      } catch {
        // Fallback below.
      }
    }

    return trimmed
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (rawValue == null) {
    return [];
  }

  const asString = String(rawValue).trim();
  return asString ? [asString] : [];
}

export function toDeviceIdsJson(deviceIds: string[]): string {
  return JSON.stringify(deviceIds);
}
