import type { Verdict } from '@pkgwarden/contracts';
import type { DiffJudgment } from '../judges/diff-judge.js';
import type { MaintenanceJudgment } from '../judges/maintenance-judge.js';
import { CODE_CHECKS, type RuleOutcome } from '../rules/rules.js';

/** How a judge ended, and its judgment when it finished. */
export interface JudgeResult<J> {
  readonly status: string;
  readonly judgment?: J | undefined;
}

/** Everything the verdict is decided from. */
export interface VerdictInput {
  readonly outcomes: readonly RuleOutcome[];
  readonly diff?: JudgeResult<DiffJudgment> | undefined;
  readonly maintenance?: JudgeResult<MaintenanceJudgment> | undefined;
}

const RANK: Record<Verdict, number> = { allow: 0, review: 1, undecided: 2, block: 3 };

/**
 * Turns rule results and judgments into one verdict. Plain code on purpose: a person
 * should be able to read exactly why something was blocked.
 */
export function decideVerdict(input: VerdictInput): { verdict: Verdict; reasons: string[] } {
  let verdict: Verdict = 'allow';
  const reasons: string[] = [];
  const raise = (to: Verdict, reason: string) => {
    if (RANK[to] > RANK[verdict]) verdict = to;
    reasons.push(reason);
  };

  const flagged = input.outcomes.filter(o => o.status === 'flagged');
  for (const o of flagged.filter(o => o.severity === 'critical')) raise('block', o.message);

  const malwareCheck = input.outcomes.find(o => o.checkId === 'known-malware');
  if (malwareCheck?.status === 'unknown') raise('review', `malware reports not checked: ${malwareCheck.message}`);

  const codeFlags = flagged.filter(o => CODE_CHECKS.has(o.checkId) && o.severity !== 'critical');
  if (codeFlags.length > 0) {
    const judgment = input.diff?.judgment;
    if (judgment) {
      if (judgment.risk === 'high') raise('block', `diff judge: ${judgment.summary}`);
      else if (judgment.risk === 'medium') raise('review', `diff judge: ${judgment.summary}`);
      else reasons.push(`the diff judge found nothing risky in the flagged code: ${judgment.summary}`);
      if (judgment.injectionAttempt) raise('review', 'the package contains text that tries to instruct AI reviewers');
    } else if (!input.diff || input.diff.status === 'skipped') {
      // Rules-only mode: without a judge, anything medium or above goes to a person.
      for (const o of codeFlags.filter(o => o.severity !== 'low' && o.severity !== 'info')) raise('review', o.message);
    } else {
      raise(
        'undecided',
        `the diff judge did not finish (${input.diff.status}) and the code checks flagged: ${codeFlags.map(o => o.message).join('; ')}`
      );
    }
  }

  const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
  const bySeverity = [...flagged].sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  for (const o of bySeverity) {
    if (o.severity === 'critical' || CODE_CHECKS.has(o.checkId)) continue;
    if (o.severity === 'high' || o.severity === 'medium') raise('review', o.message);
  }

  const m = input.maintenance?.judgment;
  if (m && (m.status === 'abandoned' || m.status === 'troubled')) {
    raise('review', `maintenance: ${m.status}${m.reasons[0] ? `, ${m.reasons[0]}` : ''}`);
  }

  if (verdict === 'allow' && reasons.length === 0) reasons.push('no check found anything that needs a person');
  return { verdict, reasons };
}
