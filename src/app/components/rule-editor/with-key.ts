import type { Json } from '../../../lib/doc';

/** A copy of `object` with `key` set to `value`, or without `key` when `value` is undefined. The original is unchanged. */
export function withKey<T extends object>(object: T, key: string, value: Json | undefined): T {
  const copy = { ...object } as Record<string, unknown>;
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy as T;
}
