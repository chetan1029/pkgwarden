import { describe, expect, it } from 'vitest';
import { diffLockfiles, parseLockfile, parsePackageLock, parsePnpmLock } from '../src/index.js';

describe('lockfile diffs', () => {
  it('lists new and upgraded packages from package-lock.json', () => {
    const before = parsePackageLock(
      JSON.stringify({
        packages: { '': {}, 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } },
      })
    );
    const after = parsePackageLock(
      JSON.stringify({
        packages: {
          '': {},
          'node_modules/a': { version: '1.1.0' },
          'node_modules/b': { version: '2.0.0' },
          'node_modules/b/node_modules/c': { version: '0.1.0' },
        },
      })
    );
    expect(diffLockfiles(before, after)).toEqual([
      { name: 'a', from: '1.0.0', to: '1.1.0' },
      { name: 'c', to: '0.1.0' },
    ]);
  });

  it('reads pnpm-lock.yaml package keys and ignores snapshots', () => {
    const lock =
      "lockfileVersion: '9.0'\n\npackages:\n\n  '@scope/x@1.0.0':\n    resolution: {}\n\n  y@2.1.0(react@18.0.0):\n    resolution: {}\n\nsnapshots:\n  z@9.9.9: {}\n";
    expect([...parsePnpmLock(lock).keys()].sort()).toEqual(['@scope/x', 'y']);
  });

  it('refuses a lockfile format it cannot read, and names the ones it can', () => {
    expect(() => parseLockfile('yarn.lock', '')).toThrow('use package-lock.json or pnpm-lock.yaml');
  });
});
