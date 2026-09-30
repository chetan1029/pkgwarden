import { describe, expect, it } from 'vitest';
import { parseCli, UsageError } from '../src/args.js';

function problems(argv: string[]): readonly string[] {
  try {
    parseCli(argv);
  } catch (err) {
    if (err instanceof UsageError) return err.problems;
    throw err;
  }
  return [];
}

describe('command line', () => {
  it('treats a finding as success by default', () => {
    expect(parseCli(['demo']).failOn).toBe('never');
  });

  it('suggests the closest option for a typo', () => {
    expect(problems(['check', 'x', '--budgt', '1'])).toEqual(['--budgt is not an option; did you mean --budget?']);
  });

  it('suggests the closest command for a typo', () => {
    expect(problems(['chek', 'x'])).toEqual(['"chek" is not a command; did you mean check?']);
  });

  it('refuses a budget above the ceiling instead of lowering it quietly', () => {
    expect(problems(['check', 'x', '--budget', '5'])).toEqual(['--budget 5 is above the ceiling of 2.00 dollars']);
  });

  it('reports every problem at once', () => {
    expect(problems(['diff', '--budget', 'lots', '--fail-on', 'sometimes', '--from', '1.0.0'])).toEqual([
      'diff needs two lockfiles: the old one, then the new one',
      '--from only works with check',
      '--budget takes a number of dollars, for example --budget 0.25; got "lots"',
      '--fail-on takes block, review or never; got "sometimes"',
    ]);
  });

  it('refuses asking for rules only and models together', () => {
    expect(problems(['check', 'x', '--rules-only', '--models'])).toEqual([
      '--rules-only and --models cannot be used together',
    ]);
  });
});
