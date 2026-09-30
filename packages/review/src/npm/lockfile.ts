import type { PackageTarget } from '@pkgwarden/contracts';

/** Every version of every package a lockfile installs. */
export type LockfileVersions = Map<string, Set<string>>;

function add(map: LockfileVersions, name: string, version: string) {
  if (!name || !version || version.startsWith('file:') || version.startsWith('link:')) return;
  const set = map.get(name) ?? new Set<string>();
  set.add(version);
  map.set(name, set);
}

/** package-lock.json, lockfile versions 1 to 3. */
export function parsePackageLock(text: string): LockfileVersions {
  const lock = JSON.parse(text) as {
    packages?: Record<string, { version?: string; link?: boolean }>;
    dependencies?: Record<string, unknown>;
  };
  const out: LockfileVersions = new Map();
  if (lock.packages) {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.link || !entry.version) continue;
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      add(out, name, entry.version);
    }
    return out;
  }
  const walk = (deps: Record<string, unknown> | undefined) => {
    for (const [name, value] of Object.entries(deps ?? {})) {
      const entry = value as { version?: string; dependencies?: Record<string, unknown> };
      if (entry.version) add(out, name, entry.version);
      walk(entry.dependencies);
    }
  };
  walk(lock.dependencies);
  return out;
}

/** pnpm-lock.yaml v6 to v9. Reads the keys of the top-level `packages:` map, no YAML parser needed. */
export function parsePnpmLock(text: string): LockfileVersions {
  const out: LockfileVersions = new Map();
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages) continue;
    const m = line.match(/^ {2}['"]?\/?((?:@[^/@'"\s]+\/)?[^@/'"\s(]+)@([^(:'"\s]+)/);
    if (m?.[1] && m[2]) add(out, m[1], m[2]);
  }
  return out;
}

/** Picks the parser from the file name. Refuses anything that is not package-lock.json or pnpm-lock.yaml. */
export function parseLockfile(fileName: string, text: string): LockfileVersions {
  if (fileName.endsWith('pnpm-lock.yaml')) return parsePnpmLock(text);
  if (fileName.endsWith('.json')) return parsePackageLock(text);
  throw new Error(`unsupported lockfile ${fileName}: use package-lock.json or pnpm-lock.yaml`);
}

/** Orders version strings numerically where they are numbers. Good enough for sorting a lockfile. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c;
  }
  return 0;
}

/** Every version that appears in the new lockfile but not the old one, paired with the version it replaces. */
export function diffLockfiles(before: LockfileVersions, after: LockfileVersions): PackageTarget[] {
  const targets: PackageTarget[] = [];
  for (const [name, versions] of [...after].sort(([a], [b]) => a.localeCompare(b))) {
    const old = before.get(name);
    for (const version of [...versions].sort(compareVersions)) {
      if (old?.has(version)) continue;
      const from = old ? [...old].sort(compareVersions).at(-1) : undefined;
      targets.push({ name, to: version, ...(from ? { from } : {}) });
    }
  }
  return targets;
}
