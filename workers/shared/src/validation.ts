export const PROVIDER_PATTERN = /^[A-Za-z0-9_-]+$/;
export const HASH_ID_PATTERN = /^[0-9a-fA-F]{8}$/;
export const DEVID_PATTERN = /^[A-Za-z0-9_, -]+$/;

export function isValidProvider(value: string): boolean {
  return value.length >= 1 && value.length <= 32 && PROVIDER_PATTERN.test(value);
}

export function isValidHashId(value: string): boolean {
  return HASH_ID_PATTERN.test(value);
}

export function isValidDevid(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && DEVID_PATTERN.test(value);
}
