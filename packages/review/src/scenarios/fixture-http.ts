import { FixtureHttp } from '../http/fixture.js';
import { createTarGz, integrityOf } from '../npm/tarball.js';
import { registryPath } from '../npm/util.js';
import { daysAgo, type FixturePackage } from './types.js';

/**
 * A fake registry, OSV, downloads API and GitHub for the given packages. Tarballs are real
 * gzipped archives with correct integrity hashes, so the whole reviewer runs unchanged.
 */
export function fixtureHttp(packages: readonly FixturePackage[]): FixtureHttp {
  const http = new FixtureHttp();
  const advisories = new Map<string, { id: string; summary: string; severity?: string }[]>();

  for (const pkg of packages) {
    const base = pkg.name.replace(/^@[^/]+\//, '');
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = { created: pkg.versions[0]?.publishedAt ?? daysAgo(1000) };
    for (const v of pkg.versions) {
      const manifest = {
        name: pkg.name,
        version: v.version,
        scripts: v.scripts ?? {},
        dependencies: v.dependencies ?? {},
      };
      const tgz = createTarGz({ 'package.json': JSON.stringify(manifest, null, 2), ...v.files });
      const tarball = `https://registry.npmjs.org/${pkg.name}/-/${base}-${v.version}.tgz`;
      http.on('GET', tarball, () => ({ status: 200, body: tgz }));
      const unpackedSize = Object.values(v.files).reduce((n, f) => n + Buffer.byteLength(f), 0);
      versions[v.version] = {
        ...manifest,
        license: v.license ?? 'MIT',
        maintainers: (v.maintainers ?? ['alice']).map(name => ({ name })),
        _npmUser: { name: v.publisher ?? v.maintainers?.[0] ?? 'alice' },
        repository: {
          type: 'git',
          url:
            v.repository ?? `git+https://github.com/${pkg.github?.owner ?? 'example'}/${pkg.github?.repo ?? base}.git`,
        },
        dist: {
          tarball,
          integrity: integrityOf(tgz),
          unpackedSize,
          fileCount: Object.keys(v.files).length + 1,
          ...(v.provenance
            ? {
                attestations: {
                  url: `${tarball}.att`,
                  provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
                },
              }
            : {}),
        },
      };
      time[v.version] = v.publishedAt;
      for (const a of pkg.advisories?.[v.version] ?? [])
        advisories.set(`${pkg.name}@${v.version}`, [...(advisories.get(`${pkg.name}@${v.version}`) ?? []), a]);
    }
    time.modified = Object.values(time).sort().at(-1) ?? daysAgo(1);
    const latest = pkg.versions.at(-1)?.version ?? '0.0.0';
    http.on('GET', `https://registry.npmjs.org/${registryPath(pkg.name)}`, {
      name: pkg.name,
      'dist-tags': { latest },
      time,
      versions,
    });
    http.on('GET', `https://api.npmjs.org/downloads/point/last-week/${pkg.name}`, {
      downloads: pkg.weeklyDownloads ?? 10_000,
      package: pkg.name,
    });

    if (pkg.github) {
      const g = pkg.github;
      const repoUrl = `https://api.github.com/repos/${g.owner}/${g.repo}`;
      http.on('GET', repoUrl, {
        archived: g.archived ?? false,
        pushed_at: g.pushedAt,
        open_issues_count: 4,
        stargazers_count: 310,
      });
      http.on(
        'GET',
        `${repoUrl}/commits?per_page=10`,
        (g.commits ?? []).map((c, i) => ({
          sha: `${i}abcdef1234567`,
          commit: { message: c.message, author: { date: c.date } },
        }))
      );
      http.on(
        'GET',
        `${repoUrl}/issues?state=all&sort=updated&per_page=10`,
        (g.issues ?? []).map((issue, i) => ({
          number: i + 1,
          title: issue.title,
          state: issue.state,
          updated_at: issue.updatedAt,
          comments: 2,
        }))
      );
      http.on('GET', `${repoUrl}/releases?per_page=5`, []);
    }
  }

  http.on('POST', 'https://api.osv.dev/v1/query', (request: { body?: unknown }) => {
    const body = request.body as { package?: { name?: string }; version?: string } | undefined;
    const list = advisories.get(`${body?.package?.name}@${body?.version}`) ?? [];
    return {
      status: 200,
      body: list.length
        ? {
            vulns: list.map(a => ({
              id: a.id,
              summary: a.summary,
              database_specific: { severity: a.severity },
            })),
          }
        : {},
    };
  });
  return http;
}
