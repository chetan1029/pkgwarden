export {
  buildExcerpts,
  diffPackages,
  type AddedLine,
  type Excerpt,
  type FileChange,
  type PackageDiff,
  type PackageFiles,
} from './analysis/diff.js';
export { installTimeFiles, looksMinified, type PatternHit, scanChanges } from './analysis/patterns.js';
export { type HttpClient, type HttpResponse, type JsonRequest, liveHttp, type LiveHttpOptions } from './http/client.js';
export { FixtureHttp, type Route } from './http/fixture.js';
export { diffConfirm, diffJudge, DiffJudgeInput, diffJudgePrompt, DiffJudgment } from './judges/diff-judge.js';
export { MaintenanceInput, maintenanceJudge, MaintenanceJudgment } from './judges/maintenance-judge.js';
export {
  compareVersions,
  diffLockfiles,
  type LockfileVersions,
  parseLockfile,
  parsePackageLock,
  parsePnpmLock,
} from './npm/lockfile.js';
export { isPopular, POPULAR_PACKAGES } from './npm/popular.js';
export {
  createTarGz,
  DEFAULT_TAR_LIMITS,
  integrityOf,
  readTarGz,
  type TarContents,
  type TarLimits,
  verifyIntegrity,
} from './npm/tarball.js';
export {
  daysBetween,
  editDistance,
  githubRepo,
  parseSpec,
  previousVersion,
  type RepoRef,
  registryPath,
} from './npm/util.js';
export { reviewPackage } from './review/review-package.js';
export { reviewPackages, ReviewSetInput, ReviewSetOutput } from './review/review-packages.js';
export { decideVerdict, type JudgeResult, type VerdictInput } from './review/verdict.js';
export {
  createReviewer,
  DEFAULT_BUDGET_USD,
  REVIEW_AGENTS,
  ROOT_AGENT,
  reviewTools,
  type ReviewerOptions,
} from './reviewer.js';
export { CODE_CHECKS, type JudgeId, RULES, type ReviewEvidence, type RuleOutcome, runRules } from './rules/rules.js';
export { Advisory, Manifest, PackumentSummary, TarballContents } from './sources/outputs.js';
