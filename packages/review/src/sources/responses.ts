import { z } from 'zod';

/**
 * What the outside services send us, as far as this code reads it. Everything crossing the
 * network is `unknown` until one of these parses it; unknown extra fields are kept out of the way with `.loose()`.
 */

/** A person in a registry manifest: a string such as `Name <mail>` or an object with a name. */
export const RegistryPerson = z.union([z.string(), z.object({ name: z.string().optional() }).loose()]);

/** One version manifest in a registry packument. Messy fields stay `unknown` and are cleaned in npm.ts. */
export const RegistryManifest = z
  .object({
    version: z.string(),
    license: z.unknown().optional(),
    scripts: z.unknown().optional(),
    dependencies: z.unknown().optional(),
    maintainers: z.array(z.unknown()).optional(),
    _npmUser: z.unknown().optional(),
    repository: z.unknown().optional(),
    deprecated: z.unknown().optional(),
    dist: z
      .object({
        tarball: z.string(),
        integrity: z.string().optional(),
        unpackedSize: z.number().optional(),
        fileCount: z.number().optional(),
        attestations: z.unknown().optional(),
      })
      .loose(),
  })
  .loose();

/** A full registry packument: every version, its publish time and its manifest. */
export const RegistryPackument = z
  .object({
    name: z.string(),
    'dist-tags': z.record(z.string(), z.string()).default({}),
    time: z.record(z.string(), z.string()).default({}),
    versions: z.record(z.string(), z.unknown()).default({}),
  })
  .loose();

/** api.npmjs.org weekly downloads. */
export const NpmDownloads = z.object({ downloads: z.number().int() }).loose();

/** OSV.dev `/v1/query` answer. No `vulns` key means none are known. */
export const OsvQueryResponse = z
  .object({
    vulns: z
      .array(
        z
          .object({
            id: z.string(),
            summary: z.string().optional(),
            details: z.string().optional(),
            database_specific: z.object({ severity: z.string().optional() }).loose().optional(),
          })
          .loose()
      )
      .optional(),
  })
  .loose();

/** deps.dev `/v3/systems/npm/packages/{name}/versions/{version}`. */
export const DepsDevVersion = z
  .object({
    licenses: z.array(z.string()).optional(),
    relatedProjects: z
      .array(z.object({ projectKey: z.object({ id: z.string() }), relationType: z.string().optional() }).loose())
      .optional(),
  })
  .loose();

/** deps.dev `/v3/projects/{id}`. */
export const DepsDevProject = z
  .object({ scorecard: z.object({ overallScore: z.number().optional() }).loose().optional() })
  .loose();

/** GitHub `GET /repos/{owner}/{repo}`. */
export const GitHubRepo = z
  .object({
    archived: z.boolean(),
    pushed_at: z.string().nullable(),
    open_issues_count: z.number(),
    stargazers_count: z.number(),
  })
  .loose();

/** GitHub `GET /repos/{owner}/{repo}/commits`. */
export const GitHubCommits = z.array(
  z
    .object({
      sha: z.string(),
      commit: z.object({ message: z.string(), author: z.object({ date: z.string() }).loose().nullable() }).loose(),
    })
    .loose()
);

/** GitHub `GET /repos/{owner}/{repo}/issues`, which also lists pull requests. */
export const GitHubIssues = z.array(
  z
    .object({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      updated_at: z.string(),
      comments: z.number(),
      pull_request: z.unknown().optional(),
    })
    .loose()
);

/** GitHub `GET /repos/{owner}/{repo}/releases`. */
export const GitHubReleases = z.array(z.object({ tag_name: z.string(), published_at: z.string().nullable() }).loose());
