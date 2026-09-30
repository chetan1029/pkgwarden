import { z } from 'zod';

/**
 * What our tools return. These are stored in the cache, so a change here that breaks old
 * entries needs a new tool id or a cache key change. New fields get defaults.
 */

/** One version's manifest, cleaned up: licence and repository as strings, people as names. */
export const Manifest = z.object({
  version: z.string(),
  license: z.string().optional(),
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()),
  maintainers: z.array(z.string()),
  publisher: z.string().optional(),
  repository: z.string().optional(),
  deprecated: z.string().optional(),
  tarball: z.string(),
  integrity: z.string().optional(),
  unpackedSize: z.number().optional(),
  fileCount: z.number().optional(),
  hasProvenance: z.boolean(),
});
/** One version's manifest, cleaned up. */
export type Manifest = z.infer<typeof Manifest>;

/** `npm.packument`: publish history plus the manifests of the requested version and the one before it. */
export const PackumentSummary = z.object({
  name: z.string(),
  /** False means we looked and the package or version is not on the registry. */
  found: z.boolean(),
  distTags: z.record(z.string(), z.string()),
  created: z.string().optional(),
  lastPublished: z.string().optional(),
  versionCount: z.number().int(),
  versionTimes: z.record(z.string(), z.string()),
  to: Manifest.optional(),
  from: Manifest.optional(),
});
/** `npm.packument` output. */
export type PackumentSummary = z.infer<typeof PackumentSummary>;

/** `npm.downloads`: null means the API has no count for the package. */
export const Downloads = z.object({ weekly: z.number().int().nullable() });
/** `npm.downloads` output. */
export type Downloads = z.infer<typeof Downloads>;

/** One file in a tarball. `text` is only present for text files under the size limit. */
export const FileEntry = z.object({ size: z.number().int(), sha256: z.string(), text: z.string().optional() });
/** One file in a tarball. */
export type FileEntry = z.infer<typeof FileEntry>;

/** `npm.tarball`: every readable file, and every entry that was skipped and why. */
export const TarballContents = z.object({
  integrity: z.string(),
  verified: z.boolean(),
  totalBytes: z.number().int(),
  files: z.record(z.string(), FileEntry),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
/** `npm.tarball` output. */
export type TarballContents = z.infer<typeof TarballContents>;

/** One OSV advisory. OpenSSF malicious-package reports use `MAL-` ids. */
export const Advisory = z.object({
  id: z.string(),
  summary: z.string(),
  severity: z.string().nullable(),
  malicious: z.boolean(),
  url: z.string(),
});
/** One OSV advisory. */
export type Advisory = z.infer<typeof Advisory>;

/** `osv.query` output. */
export const Advisories = z.object({ advisories: z.array(Advisory) });
/** `osv.query` output. */
export type Advisories = z.infer<typeof Advisories>;

/** `depsdev.version` output. `found: false` means deps.dev has no record of this version. */
export const DepsDevSummary = z.object({
  found: z.boolean(),
  licenses: z.array(z.string()),
  sourceRepo: z.string().optional(),
  scorecard: z.number().optional(),
});
/** `depsdev.version` output. */
export type DepsDevSummary = z.infer<typeof DepsDevSummary>;

/** `github.repo` output. */
export const RepoFacts = z.object({
  found: z.boolean(),
  archived: z.boolean().optional(),
  pushedAt: z.string().optional(),
  openIssues: z.number().int().optional(),
  stars: z.number().int().optional(),
});

/** `github.recentCommits` output. */
export const RecentCommits = z.object({
  commits: z.array(z.object({ sha: z.string(), date: z.string(), message: z.string() })),
});

/** `github.recentIssues` output. */
export const RecentIssues = z.object({
  issues: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      state: z.string(),
      updatedAt: z.string(),
      comments: z.number().int(),
      pullRequest: z.boolean(),
    })
  ),
});

/** `github.releases` output. */
export const Releases = z.object({ releases: z.array(z.object({ tag: z.string(), publishedAt: z.string() })) });
