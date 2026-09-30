/** A stored value with when it was written, when it expires, and who wrote it. */
export interface StoredEntry<T> {
  readonly value: T;
  readonly storedAt: string;
  readonly expiresAt?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/** How long to keep an entry and what to record about it. */
export interface SetOptions {
  readonly ttlMs?: number | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Key-value storage for tool results and model judgments. Keys are hex hashes and
 * namespaces are fixed strings, so neither is ever user input.
 */
export interface Store {
  get<T>(namespace: string, key: string): Promise<StoredEntry<T> | undefined>;
  set<T>(namespace: string, key: string, value: T, options?: SetOptions): Promise<void>;
}

/** True when the entry has a TTL that has passed. */
export function isExpired(entry: StoredEntry<unknown>, now: Date): boolean {
  return entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= now.getTime();
}

/** Builds the entry to store for `value`. */
export function makeEntry<T>(value: T, options: SetOptions | undefined, now: Date): StoredEntry<T> {
  return {
    value,
    storedAt: now.toISOString(),
    expiresAt: options?.ttlMs !== undefined ? new Date(now.getTime() + options.ttlMs).toISOString() : undefined,
    meta: options?.meta,
  };
}
