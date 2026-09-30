import { isExpired, makeEntry, type SetOptions, type Store, type StoredEntry } from './store.js';

/** A Store in memory, for tests, evals and the demo. Values are copied in and out, like a real store. */
export class MemoryStore implements Store {
  readonly #entries = new Map<string, StoredEntry<unknown>>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  async get<T>(namespace: string, key: string): Promise<StoredEntry<T> | undefined> {
    const entry = this.#entries.get(`${namespace}/${key}`);
    if (!entry || isExpired(entry, this.#clock())) return undefined;
    return structuredClone(entry) as StoredEntry<T>;
  }

  async set<T>(namespace: string, key: string, value: T, options?: SetOptions): Promise<void> {
    this.#entries.set(`${namespace}/${key}`, structuredClone(makeEntry(value, options, this.#clock())));
  }

  /** How many entries are held, expired or not. */
  get size(): number {
    return this.#entries.size;
  }
}
