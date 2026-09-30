import { createHash } from 'node:crypto';

/**
 * JSON with sorted object keys and no undefined values, so two equal values always
 * serialise to the same string. Cache keys and trace hashes are built on this.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    return value;
  }
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => normalise(v) ?? null);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = normalise((value as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Hex SHA-256 of a string or bytes. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Hex SHA-256 of the canonical JSON of `value`: equal values always get the same hash. */
export function hashOf(value: unknown): string {
  return sha256(canonicalJson(value));
}
