import { describe, expect, it } from 'vitest';
import { decideVerdict, type RuleOutcome } from '../src/index.js';

const flagged = (checkId: string, severity: RuleOutcome['severity']): RuleOutcome => ({
  checkId,
  status: 'flagged',
  severity,
  message: `${checkId} flagged`,
  evidence: [],
});

const judgment = (risk: 'low' | 'medium' | 'high') => ({
  status: 'done',
  judgment: { summary: `risk is ${risk}`, behaviours: [], risk, injectionAttempt: false },
});

describe('verdict', () => {
  it('is undecided, not allow, when the judge did not finish', () => {
    const v = decideVerdict({ outcomes: [flagged('install-script', 'high')], diff: { status: 'out_of_budget' } });
    expect(v.verdict).toBe('undecided');
  });

  it('lets the judge clear flagged code it found harmless', () => {
    const v = decideVerdict({ outcomes: [flagged('install-script', 'high')], diff: judgment('low') });
    expect(v.verdict).toBe('allow');
  });

  it('sends flagged code to a person in rules-only mode', () => {
    const v = decideVerdict({ outcomes: [flagged('suspicious-code', 'medium')], diff: { status: 'skipped' } });
    expect(v.verdict).toBe('review');
  });

  it('blocks on a critical finding whatever the judge said', () => {
    const v = decideVerdict({ outcomes: [flagged('known-malware', 'critical')], diff: judgment('low') });
    expect(v.verdict).toBe('block');
  });

  it('puts the most serious reason first', () => {
    const v = decideVerdict({ outcomes: [flagged('fresh-publish', 'medium'), flagged('lookalike-name', 'high')] });
    expect(v.reasons[0]).toBe('lookalike-name flagged');
  });
});
