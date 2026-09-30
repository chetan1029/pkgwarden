import { PackageVerdict, reduce, RunEvent } from '@pkgwarden/contracts';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios/index.js';
import { reviewScenario } from './support.js';

describe('scenarios with offline judges', () => {
  for (const scenario of SCENARIOS) {
    it(`gives ${scenario.id} the verdict ${scenario.expected}`, async () => {
      const { verdict } = await reviewScenario(scenario.id);
      expect(verdict.verdict, verdict.reasons.join('\n')).toBe(scenario.expected);
    });
  }

  it('produces verdicts and events that match the contract', async () => {
    const { verdict, events } = await reviewScenario('postinstall-exfil');
    expect(PackageVerdict.safeParse(verdict).success).toBe(true);
    expect(events.every(e => RunEvent.safeParse(e).success)).toBe(true);
  });

  it('only calls the model when a rule asks for it', async () => {
    const { events } = await reviewScenario('clean-upgrade');
    expect(reduce(events).modelCalls).toBe(0);
    const skipped = events.filter(e => e.type === 'agent.skipped');
    expect(skipped.map(e => e.type === 'agent.skipped' && e.reason)).toEqual([
      'no rule asked for it',
      'no rule asked for it',
    ]);
  });

  it('confirms with the large model before blocking', async () => {
    const { verdict, events } = await reviewScenario('postinstall-exfil');
    expect(reduce(events).agents.map(a => a.agentId)).toContain('diff-confirm');
    expect(verdict.judges.map(j => j.agentId)).toEqual(['diff-judge', 'diff-confirm']);
  });

  it('notices text aimed at AI reviewers', async () => {
    const { verdict } = await reviewScenario('prompt-injection');
    expect(verdict.reasons.join(' ')).toMatch(/instruct AI reviewers/);
  });

  it('blocks known malware without spending anything on models', async () => {
    const { result } = await reviewScenario('known-malware');
    expect(result.costUsd).toBe(0);
  });
});

describe('rules-only mode', () => {
  it('sends flagged code to a person instead of allowing it', async () => {
    const { verdict } = await reviewScenario('postinstall-exfil', { withModels: false });
    expect(verdict.verdict).toBe('review');
  });

  it('still blocks what the rules can prove on their own', async () => {
    const { verdict } = await reviewScenario('known-malware', { withModels: false });
    expect(verdict.verdict).toBe('block');
  });
});
