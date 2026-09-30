import type { PackageTarget, Verdict } from '@pkgwarden/contracts';

/**
 * Hand-made test packages. Every "malicious" sample is fake: it points at .invalid domains
 * and is only ever read as text, never installed or run.
 */
/** One version of a fake package: its files and registry metadata. */
export interface FixtureVersion {
  version: string;
  publishedAt: string;
  files: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  maintainers?: string[];
  publisher?: string;
  license?: string;
  provenance?: boolean;
  repository?: string;
}

/** A fake package, with what the registry, OSV and GitHub should say about it. */
export interface FixturePackage {
  name: string;
  versions: FixtureVersion[];
  weeklyDownloads?: number;
  advisories?: Record<string, { id: string; summary: string; severity?: string }[]>;
  github?: {
    owner: string;
    repo: string;
    archived?: boolean;
    pushedAt: string;
    commits?: { date: string; message: string }[];
    issues?: { title: string; state: string; updatedAt: string }[];
  };
}

/** One eval and demo case: a package change and the verdict it should get. */
export interface Scenario {
  id: string;
  description: string;
  target: PackageTarget;
  expected: Verdict;
  packages: FixturePackage[];
}

/** The fixed "now" every scenario is judged at, so ages and freshness never drift. */
export const EVAL_NOW = new Date('2026-09-20T12:00:00Z');
/** An ISO time `d` days before EVAL_NOW. */
export const daysAgo = (d: number): string => new Date(EVAL_NOW.getTime() - d * 86_400_000).toISOString();
/** An ISO time `h` hours before EVAL_NOW. */
export const hoursAgo = (h: number): string => new Date(EVAL_NOW.getTime() - h * 3_600_000).toISOString();
