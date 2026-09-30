/** Splits `name@version` and `@scope/name@version`. The version is optional. */
export function parseSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined } as {
    name: string;
    version?: string;
  };
}

/** The registry wants `@scope%2Fname`; other APIs take the name as is. */
/** The registry path for a name: `@scope%2Fname` for scoped packages. */
export function registryPath(name: string): string {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

const PRERELEASE = /-/;

/** The version published just before `version`, ignoring prereleases. */
export function previousVersion(times: Record<string, string>, version: string): string | undefined {
  const at = times[version];
  if (!at) return undefined;
  let best: { v: string; t: number } | undefined;
  for (const [v, t] of Object.entries(times)) {
    if (v === 'created' || v === 'modified' || v === version || PRERELEASE.test(v)) continue;
    const ms = Date.parse(t);
    if (ms < Date.parse(at) && (!best || ms > best.t)) best = { v, t: ms };
  }
  return best?.v;
}

/** A GitHub repository. */
export interface RepoRef {
  owner: string;
  repo: string;
}

/** Understands `git+https://github.com/o/r.git`, `github:o/r`, `o/r` and `{ url }`. */
export function githubRepo(repository: unknown): RepoRef | undefined {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? String((repository as { url: unknown }).url)
        : undefined;
  if (!raw) return undefined;
  const short = raw.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/);
  const full = raw.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/].*)?$/);
  const m = full ?? short;
  if (!m?.[1] || !m[2]) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

/** Days from an ISO timestamp to `to`. Negative when the timestamp is in the future. */
export function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - Date.parse(fromIso)) / 86_400_000;
}

/** Damerau-Levenshtein distance with transpositions, used for lookalike package names. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}
