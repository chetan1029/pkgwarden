import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isExpired, makeEntry, type SetOptions, type Store, type StoredEntry } from './store.js';

const NAMESPACE = /^[a-zA-Z0-9._:-]+$/;
const KEY = /^[a-f0-9]{16,128}$/;

/**
 * One JSON file per entry. Writes go through a uniquely named temp file and a rename,
 * so a reader never sees half a file and two writers never share a temp file.
 * Refuses any namespace or key that is not a plain name or a hex hash.
 */
export class FileStore implements Store {
  readonly #dir: string;
  readonly #clock: () => Date;

  constructor(dir: string, clock: () => Date = () => new Date()) {
    this.#dir = dir;
    this.#clock = clock;
  }

  #path(namespace: string, key: string): string {
    if (!NAMESPACE.test(namespace)) throw new Error(`store namespace "${namespace}" is not a plain name`);
    if (!KEY.test(key)) throw new Error(`store key "${key}" is not a hex hash`);
    return join(this.#dir, namespace.replaceAll(':', '_'), `${key}.json`);
  }

  async get<T>(namespace: string, key: string): Promise<StoredEntry<T> | undefined> {
    let text: string;
    try {
      text = await readFile(this.#path(namespace, key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    const entry = JSON.parse(text) as StoredEntry<T>;
    return isExpired(entry, this.#clock()) ? undefined : entry;
  }

  async set<T>(namespace: string, key: string, value: T, options?: SetOptions): Promise<void> {
    const path = this.#path(namespace, key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(makeEntry(value, options, this.#clock())));
    await rename(tmp, path);
  }
}
