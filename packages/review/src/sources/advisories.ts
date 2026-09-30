import { type AnyTool, defineTool } from '@pkgwarden/engine';
import { z } from 'zod';
import type { HttpClient } from '../http/client.js';
import { Advisories, DepsDevSummary } from './outputs.js';
import { DepsDevProject, DepsDevVersion, OsvQueryResponse } from './responses.js';

/** Tools for known vulnerabilities and malware reports (OSV.dev) and project health (deps.dev). */
export function advisoryTools(http: HttpClient): AnyTool[] {
  const osv = defineTool({
    id: 'osv.query',
    description: 'Known vulnerabilities and malicious-package reports for one npm package version, from OSV.dev.',
    input: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    output: Advisories,
    // Reports can appear hours after a malicious publish, so this is always fetched fresh.
    cache: { kind: 'none' },
    async run(input, ctx) {
      const res = await http.json(
        'https://api.osv.dev/v1/query',
        { method: 'POST', body: { package: { name: input.name, ecosystem: 'npm' }, version: input.version } },
        ctx.signal
      );
      if (res.status !== 200) throw new Error(`OSV answered ${res.status}`);
      const vulns = OsvQueryResponse.parse(res.body).vulns ?? [];
      return {
        advisories: vulns.map(v => ({
          id: v.id,
          summary: v.summary ?? v.details?.slice(0, 200) ?? '',
          severity: v.database_specific?.severity ?? null,
          malicious: v.id.startsWith('MAL-'),
          url: `https://osv.dev/vulnerability/${v.id}`,
        })),
      };
    },
  });

  const depsdev = defineTool({
    id: 'depsdev.version',
    description: 'Licences, source repository and OpenSSF Scorecard for an npm package version, from deps.dev.',
    input: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    output: DepsDevSummary,
    cache: { kind: 'ttl', ttlMs: 24 * 3_600_000 },
    async run(input, ctx) {
      const base = 'https://api.deps.dev/v3';
      const res = await http.json(
        `${base}/systems/npm/packages/${encodeURIComponent(input.name)}/versions/${encodeURIComponent(input.version)}`,
        {},
        ctx.signal
      );
      if (res.status === 404) return { found: false, licenses: [] };
      if (res.status !== 200) throw new Error(`deps.dev answered ${res.status}`);
      const version = DepsDevVersion.parse(res.body);
      const sourceRepo = version.relatedProjects?.find(p => p.relationType === 'SOURCE_REPO')?.projectKey.id;
      let scorecard: number | undefined;
      if (sourceRepo) {
        const project = await http.json(`${base}/projects/${encodeURIComponent(sourceRepo)}`, {}, ctx.signal);
        if (project.status === 200) scorecard = DepsDevProject.parse(project.body).scorecard?.overallScore;
      }
      return {
        found: true,
        licenses: version.licenses ?? [],
        ...(sourceRepo ? { sourceRepo } : {}),
        ...(scorecard !== undefined ? { scorecard } : {}),
      };
    },
  });

  return [osv, depsdev];
}
