import type { CheckResult, EvidenceRef, Severity } from '@pkgwarden/contracts';
import type { Result } from '@pkgwarden/engine';
import type { PackageDiff } from '../analysis/diff.js';
import { installTimeFiles, looksMinified, scanChanges } from '../analysis/patterns.js';
import { isPopular, POPULAR_PACKAGES } from '../npm/popular.js';
import { daysBetween, editDistance, githubRepo } from '../npm/util.js';
import type { Advisory, Manifest, PackumentSummary } from '../sources/outputs.js';

/** The judges a rule can ask for. */
export type JudgeId = 'diff-judge' | 'maintenance-judge';

export interface RuleOutcome extends CheckResult {
  /** Which judge should look when this rule flags something it cannot settle alone. */
  escalate?: JudgeId | undefined;
}

/** Everything the rules read about one package change. Plain data, so the rules are pure functions. */
export interface ReviewEvidence {
  name: string;
  to: Manifest;
  from?: Manifest | undefined;
  packument: PackumentSummary;
  now: Date;
  downloads: Result<number | null>;
  advisories: Result<readonly Advisory[]>;
  licenses?: string[] | undefined;
  /** Undefined when a tarball could not be read, so the code checks cannot run. */
  diff?: PackageDiff | undefined;
  tarballError?: string | undefined;
  newDependencies: { name: string; created?: string | undefined }[];
}

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'] as const;
/** Checks about the code itself. The diff judge settles these, so the verdict treats them together. */
export const CODE_CHECKS: ReadonlySet<string> = new Set(['install-script', 'suspicious-code', 'minified-file']);

const result = (
  checkId: string,
  status: RuleOutcome['status'],
  severity: Severity,
  message: string,
  evidence: EvidenceRef[] = [],
  escalate?: JudgeId
): RuleOutcome => ({ checkId, status, severity, message, evidence, ...(escalate ? { escalate } : {}) });

type Rule = (e: ReviewEvidence) => RuleOutcome;

const knownMalware: Rule = e => {
  if (!e.advisories.ok)
    return result(
      'known-malware',
      'unknown',
      'high',
      `could not check OSV (${e.advisories.reason}): ${e.advisories.detail}`
    );
  const mal = e.advisories.data.filter(a => a.malicious);
  if (mal.length === 0) return result('known-malware', 'passed', 'info', 'no malicious-package reports');
  return result(
    'known-malware',
    'flagged',
    'critical',
    `reported as malicious: ${mal.map(a => a.id).join(', ')}`,
    mal.map(a => ({ label: `${a.id}: ${a.summary}`, url: a.url }))
  );
};

const knownVulnerability: Rule = e => {
  if (!e.advisories.ok) return result('known-vulnerability', 'unknown', 'medium', 'could not check OSV');
  const vulns = e.advisories.data.filter(a => !a.malicious);
  if (vulns.length === 0) return result('known-vulnerability', 'passed', 'info', 'no known vulnerabilities');
  const worst = vulns.some(v => /critical|high/i.test(v.severity ?? ''))
    ? 'high'
    : vulns.some(v => /moderate|medium/i.test(v.severity ?? ''))
      ? 'medium'
      : 'low';
  return result(
    'known-vulnerability',
    'flagged',
    worst,
    `${vulns.length} known ${vulns.length === 1 ? 'vulnerability' : 'vulnerabilities'} in ${e.to.version}`,
    vulns.slice(0, 5).map(v => ({ label: `${v.id}: ${v.summary}`, url: v.url }))
  );
};

const installScript: Rule = e => {
  const hooks = INSTALL_HOOKS.filter(h => e.to.scripts[h]);
  if (hooks.length === 0) return result('install-script', 'passed', 'info', 'no install scripts');
  const shown = hooks.map(h => `${h}: ${e.to.scripts[h]}`).join('; ');
  if (!e.from)
    return result('install-script', 'flagged', 'medium', `runs a script at install (${shown})`, [], 'diff-judge');
  const changed = hooks.filter(h => e.from?.scripts[h] !== e.to.scripts[h]);
  if (changed.length === 0)
    return result('install-script', 'passed', 'info', `install script unchanged since ${e.from.version}`);
  return result(
    'install-script',
    'flagged',
    'high',
    `install script added or changed since ${e.from.version} (${changed.map(h => `${h}: ${e.to.scripts[h]}`).join('; ')})`,
    [{ label: 'package.json scripts', file: 'package.json' }],
    'diff-judge'
  );
};

const freshPublish: Rule = e => {
  const at = e.packument.versionTimes[e.to.version];
  if (!at) return result('fresh-publish', 'unknown', 'low', 'publish time not listed');
  const hours = daysBetween(at, e.now) * 24;
  if (hours < 72) {
    return result('fresh-publish', 'flagged', 'medium', `published ${Math.max(0, Math.round(hours))} hours ago`);
  }
  return result('fresh-publish', 'passed', 'info', `published ${Math.round(hours / 24)} days ago`);
};

const maintainerChange: Rule = e => {
  if (!e.from) return result('maintainer-change', 'skipped', 'info', 'no earlier version to compare');
  const before = new Set(e.from.maintainers);
  const publisher = e.to.publisher;
  if (publisher && before.size > 0 && !before.has(publisher) && publisher !== e.from.publisher) {
    // A new publisher on a fresh release is the classic account-takeover shape.
    const publishedAt = e.packument.versionTimes[e.to.version];
    const fresh = publishedAt !== undefined && daysBetween(publishedAt, e.now) < 30;
    return result(
      'maintainer-change',
      'flagged',
      fresh ? 'high' : 'medium',
      `${e.to.version} was published by ${publisher}, who did not maintain ${e.from.version}`
    );
  }
  const added = e.to.maintainers.filter(m => !before.has(m));
  if (added.length > 0) {
    return result(
      'maintainer-change',
      'flagged',
      'medium',
      `new maintainers since ${e.from.version}: ${added.join(', ')}`
    );
  }
  return result('maintainer-change', 'passed', 'info', 'same maintainers as before');
};

const lookalikeName: Rule = e => {
  if (isPopular(e.name)) return result('lookalike-name', 'passed', 'info', 'is itself a widely used package');
  const bare = e.name.replace(/^@[^/]+\//, '');
  const twin = POPULAR_PACKAGES.find(p => {
    const d = editDistance(bare, p.replace(/^@[^/]+\//, ''));
    return bare.length >= 4 && d > 0 && d <= (p.length > 6 ? 2 : 1);
  });
  const weekly = e.downloads.ok ? e.downloads.data : null;
  if (twin && (weekly === null || weekly < 50_000)) {
    return result(
      'lookalike-name',
      'flagged',
      'high',
      `name is one or two letters away from the popular package "${twin}" and has ${weekly ?? 'unknown'} weekly downloads`
    );
  }
  return result('lookalike-name', 'passed', 'info', 'name does not imitate a popular package');
};

const newDependency: Rule = e => {
  if (e.newDependencies.length === 0) return result('new-dependency', 'passed', 'info', 'no new dependencies');
  const young = e.newDependencies.filter(d => d.created && daysBetween(d.created, e.now) < 30);
  if (young.length > 0) {
    return result(
      'new-dependency',
      'flagged',
      'high',
      `adds dependencies created less than 30 days ago: ${young.map(d => d.name).join(', ')}`
    );
  }
  return result(
    'new-dependency',
    'flagged',
    'low',
    `adds dependencies: ${e.newDependencies.map(d => d.name).join(', ')}`
  );
};

const sizeJump: Rule = e => {
  const before = e.from?.unpackedSize;
  const after = e.to.unpackedSize;
  if (!before || !after) return result('size-jump', 'skipped', 'info', 'no size to compare');
  if (after > 3 * before && after > 200_000) {
    return result(
      'size-jump',
      'flagged',
      'medium',
      `unpacked size grew ${(after / before).toFixed(1)}x (${before} → ${after} bytes)`
    );
  }
  return result('size-jump', 'passed', 'info', 'size is in line with the previous version');
};

const suspiciousCode: Rule = e => {
  if (!e.diff)
    return result('suspicious-code', 'unknown', 'medium', `could not read the code: ${e.tarballError ?? 'no tarball'}`);
  const installFiles = installTimeFiles(e.to.scripts);
  const hits = scanChanges(e.diff.changes, installFiles);
  const significant = hits.filter(
    h =>
      h.installTime || ['eval', 'obfuscation', 'credential-paths', 'base64-blob', 'child-process'].includes(h.pattern)
  );
  if (significant.length === 0)
    return result('suspicious-code', 'passed', 'info', 'no suspicious patterns in the new code');
  const installTime = significant.some(h => h.installTime);
  const labels = [...new Set(significant.map(h => h.label))].join(', ');
  return result(
    'suspicious-code',
    'flagged',
    installTime ? 'high' : 'medium',
    `new ${installTime ? 'install-time ' : ''}code ${labels}`,
    significant.slice(0, 8).map(h => ({ label: h.label, file: h.file, line: h.line })),
    'diff-judge'
  );
};

const minifiedFile: Rule = e => {
  if (!e.diff) return result('minified-file', 'unknown', 'low', 'could not read the code');
  const files = e.diff.changes.filter(looksMinified).map(c => c.file);
  if (files.length === 0) return result('minified-file', 'passed', 'info', 'no new minified files');
  return result(
    'minified-file',
    'flagged',
    'medium',
    `adds minified or generated code: ${files.slice(0, 3).join(', ')}`,
    files.slice(0, 3).map(file => ({ label: 'minified file', file })),
    'diff-judge'
  );
};

const licenseChange: Rule = e => {
  const license = e.to.license ?? e.licenses?.[0];
  if (!license) return result('license-change', 'flagged', 'low', 'no licence declared');
  if (e.from?.license && e.from.license !== license) {
    return result('license-change', 'flagged', 'medium', `licence changed from ${e.from.license} to ${license}`);
  }
  return result('license-change', 'passed', 'info', `licence ${license}`);
};

const provenance: Rule = e => {
  if (e.from?.hasProvenance && !e.to.hasProvenance) {
    return result(
      'provenance',
      'flagged',
      'high',
      `${e.from.version} had a provenance attestation and ${e.to.version} does not`
    );
  }
  const before = githubRepo(e.from?.repository);
  const after = githubRepo(e.to.repository);
  if (
    before &&
    after &&
    `${before.owner}/${before.repo}`.toLowerCase() !== `${after.owner}/${after.repo}`.toLowerCase()
  ) {
    return result(
      'provenance',
      'flagged',
      'medium',
      `repository link changed from ${before.owner}/${before.repo} to ${after.owner}/${after.repo}`
    );
  }
  return result(
    'provenance',
    'passed',
    'info',
    e.to.hasProvenance ? 'published with a provenance attestation' : 'no provenance attestation (common)'
  );
};

const deprecated: Rule = e =>
  e.to.deprecated
    ? result('deprecated', 'flagged', 'low', `deprecated: ${e.to.deprecated}`)
    : result('deprecated', 'passed', 'info', 'not deprecated');

const stalePackage: Rule = e => {
  const last = e.packument.lastPublished;
  if (!last) return result('stale-package', 'unknown', 'low', 'no publish history');
  const days = daysBetween(last, e.now);
  if (days > 730) {
    return result(
      'stale-package',
      'flagged',
      'low',
      `last release was ${Math.round(days / 365)} years ago`,
      [],
      'maintenance-judge'
    );
  }
  return result('stale-package', 'passed', 'info', `last release ${Math.round(days)} days ago`);
};

const integrity: Rule = e =>
  e.tarballError?.includes('integrity mismatch')
    ? result('integrity', 'flagged', 'critical', "the downloaded tarball does not match the registry's integrity hash")
    : result('integrity', 'passed', 'info', e.diff ? 'tarball matches its integrity hash' : 'tarball not checked');

/** Every rule, in the order their results are shown. */
export const RULES: readonly Rule[] = [
  integrity,
  knownMalware,
  knownVulnerability,
  installScript,
  suspiciousCode,
  minifiedFile,
  freshPublish,
  maintainerChange,
  lookalikeName,
  newDependency,
  sizeJump,
  licenseChange,
  provenance,
  deprecated,
  stalePackage,
];

/** Runs every rule. Pure: the same evidence always gives the same results. */
export function runRules(evidence: ReviewEvidence): RuleOutcome[] {
  return RULES.map(rule => rule(evidence));
}
