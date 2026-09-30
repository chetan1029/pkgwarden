import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createTarGz, integrityOf, readTarGz, verifyIntegrity } from '../src/index.js';
import { tarWith } from './support.js';

describe('tarball reader', () => {
  it('round-trips files and strips the package/ folder', () => {
    const { files } = readTarGz(createTarGz({ 'index.js': 'hi', 'lib/a.js': 'a' }));
    expect([...files.keys()].sort()).toEqual(['index.js', 'lib/a.js']);
  });

  it('skips path traversal and links instead of reading them, and says why', () => {
    const { files, skipped } = readTarGz(
      tarWith([
        { name: 'package/../../etc/passwd', body: 'x' },
        { name: 'package/link', type: '2' },
        { name: 'package/ok.js', body: 'ok' },
      ])
    );
    expect([...files.keys()]).toEqual(['ok.js']);
    expect(skipped.map(s => s.reason).sort()).toEqual(['link', 'unsafe path']);
  });

  it('refuses a gzip that expands past the limit', () => {
    const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024));
    expect(() => readTarGz(bomb, { maxUnpackedBytes: 100_000, maxFiles: 10, maxFileBytes: 1000 })).toThrow();
  });
});

describe('integrity', () => {
  it('accepts the bytes it was computed from and refuses anything else', () => {
    const tgz = createTarGz({ 'index.js': 'x' });
    expect(verifyIntegrity(tgz, integrityOf(tgz))).toBe(true);
    expect(verifyIntegrity(createTarGz({ 'index.js': 'y' }), integrityOf(tgz))).toBe(false);
  });
});
