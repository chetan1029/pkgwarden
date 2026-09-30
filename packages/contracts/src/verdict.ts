import { z } from 'zod';

/** `undecided` means we tried and could not decide. It never counts as `allow`. */
export const Verdict = z.enum(['allow', 'review', 'block', 'undecided']);
/** `undecided` means we tried and could not decide. It never counts as `allow`. */
export type Verdict = z.infer<typeof Verdict>;

/** `unknown` means the check could not look. It is never read as `passed`. */
export const CheckStatus = z.enum(['passed', 'flagged', 'unknown', 'skipped']);
/** `unknown` means the check could not look. It is never read as `passed`. */
export type CheckStatus = z.infer<typeof CheckStatus>;

/** How much a flagged check matters. `critical` blocks on its own. */
export const Severity = z.enum(['info', 'low', 'medium', 'high', 'critical']);
/** How much a flagged check matters. `critical` blocks on its own. */
export type Severity = z.infer<typeof Severity>;

/** Where a finding can be checked: a link, or a file and line in the package. */
export const EvidenceRef = z.object({
  label: z.string(),
  url: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
});
/** Where a finding can be checked: a link, or a file and line in the package. */
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/** The result of one rule for one package change. */
export const CheckResult = z.object({
  checkId: z.string(),
  status: CheckStatus,
  severity: Severity,
  message: z.string(),
  evidence: z.array(EvidenceRef).default([]),
});
/** The result of one rule for one package change. */
export type CheckResult = z.output<typeof CheckResult>;

/** One package change to review. */
export const PackageTarget = z.object({
  name: z.string().min(1),
  /** The version we are moving away from. Missing for a newly added package. */
  from: z.string().optional(),
  /** Missing means "latest". */
  to: z.string().optional(),
});
/** One package change to review. */
export type PackageTarget = z.infer<typeof PackageTarget>;

/** What one judge concluded, or why it could not. */
export const JudgeNote = z.object({
  agentId: z.string(),
  status: z.string(),
  summary: z.string(),
});
/** What one judge concluded, or why it could not. */
export type JudgeNote = z.infer<typeof JudgeNote>;

/** The final answer for one package change, with every check and judge note behind it. */
export const PackageVerdict = z.object({
  name: z.string(),
  from: z.string().optional(),
  to: z.string(),
  verdict: Verdict,
  reasons: z.array(z.string()),
  checks: z.array(CheckResult),
  judges: z.array(JudgeNote).default([]),
});
/** The final answer for one package change, with every check and judge note behind it. */
export type PackageVerdict = z.output<typeof PackageVerdict>;

/** A short label such as `lodash 4.17.20 → 4.17.21`, or `reakt@1.0.0` for a new package. */
export function targetLabel(t: { name: string; from?: string | undefined; to?: string | undefined }): string {
  const to = t.to ?? 'latest';
  return t.from ? `${t.name} ${t.from} → ${to}` : `${t.name}@${to}`;
}
