import { fail, ok } from '@pkgwarden/engine';
import { describe, expect, it } from 'vitest';
import { type Manifest, type ReviewEvidence, runRules } from '../src/index.js';

const NOW = new Date('2026-09-20T12:00:00Z');
const manifest = (version: string, extra: Partial<Manifest> = {}): Manifest => ({
  version,
  scripts: {},
  dependencies: {},
  maintainers: ['alice'],
  publisher: 'alice',
  tarball: `https://registry.npmjs.org/p/-/p-${version}.tgz`,
  hasProvenance: false,
  license: 'MIT',
  ...extra,
});

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    name: 'some-package',
    from: manifest('1.0.0'),
    to: manifest('1.0.1'),
    packument: {
      name: 'some-package',
      found: true,
      distTags: {},
      versionCount: 2,
      versionTimes: { '1.0.0': '2025-01-01T00:00:00Z', '1.0.1': '2026-06-01T00:00:00Z' },
      lastPublished: '2026-06-01T00:00:00Z',
    },
    now: NOW,
    downloads: ok(100_000),
    advisories: ok([]),
    diff: { added: [], removed: [], changed: [], changes: [] },
    newDependencies: [],
    ...overrides,
  };
}

const check = (e: ReviewEvidence, id: string) => runRules(e).find(r => r.checkId === id);

describe('rules', () => {
  it('passes an install script that did not change', () => {
    const scripts = { postinstall: 'node build.js' };
    const e = evidence({ from: manifest('1.0.0', { scripts }), to: manifest('1.0.1', { scripts }) });
    expect(check(e, 'install-script')?.status).toBe('passed');
  });

  it('records "could not look" as unknown when OSV is unreachable, never as passed', () => {
    const e = evidence({ advisories: fail('timeout', 'OSV did not answer in time') });
    expect(check(e, 'known-malware')).toMatchObject({ status: 'unknown', message: expect.stringContaining('timeout') });
  });

  it('rates a new publisher high on a fresh release and medium on an old one', () => {
    const fresh = evidence({
      to: manifest('1.0.1', { publisher: 'mallory' }),
      packument: { ...evidence().packument, versionTimes: { '1.0.1': '2026-09-19T00:00:00Z' } },
    });
    expect(check(fresh, 'maintainer-change')?.severity).toBe('high');
    const old = evidence({ to: manifest('1.0.1', { publisher: 'mallory' }) });
    expect(check(old, 'maintainer-change')?.severity).toBe('medium');
  });

  it('cannot check code it could not read, and says so', () => {
    const e = evidence({ diff: undefined, tarballError: 'integrity mismatch: nope' });
    expect(check(e, 'suspicious-code')?.status).toBe('unknown');
    expect(check(e, 'integrity')?.severity).toBe('critical');
  });
});
