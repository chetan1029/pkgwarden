import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore, hashOf, MemoryStore } from '../src/index.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pkgwarden-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('file store', () => {
  it('reads back what it wrote', async () => {
    const store = new FileStore(dir);
    const key = hashOf('x');
    await store.set('tool:npm.packument', key, { a: 1 }, { meta: { runId: 'r1' } });
    expect(await store.get('tool:npm.packument', key)).toMatchObject({ value: { a: 1 }, meta: { runId: 'r1' } });
  });

  it('refuses a key that is not a hex hash, so a key can never become a path', async () => {
    await expect(new FileStore(dir).set('model', '../../etc/passwd', 1)).rejects.toThrow('is not a hex hash');
  });

  it('does not return an expired entry', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const store = new FileStore(dir, () => now);
    const key = hashOf('y');
    await store.set('model', key, 1, { ttlMs: 1000 });
    now = new Date('2026-01-01T00:00:02Z');
    expect(await store.get('model', key)).toBeUndefined();
  });

  it('survives concurrent writes to the same key and leaves no temp files', async () => {
    const store = new FileStore(dir);
    const key = hashOf('z');
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.set('model', key, i)));
    expect(typeof (await store.get<number>('model', key))?.value).toBe('number');
    expect((await readdir(join(dir, 'model'))).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('memory store', () => {
  it('hands out copies, so callers cannot change what is stored', async () => {
    const store = new MemoryStore();
    const key = hashOf('m');
    await store.set('model', key, { list: [1] });
    const first = await store.get<{ list: number[] }>('model', key);
    first?.value.list.push(2);
    expect((await store.get<{ list: number[] }>('model', key))?.value.list).toEqual([1]);
  });
});
