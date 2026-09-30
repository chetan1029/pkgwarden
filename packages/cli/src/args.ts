import { parseArgs } from 'node:util';
import { editDistance } from '@pkgwarden/review';

/** The most a single CLI run may spend. `--budget` can lower it, never raise it. */
export const MAX_BUDGET_USD = 2;
/** What a run spends at most when `--budget` is not given. */
export const DEFAULT_RUN_BUDGET_USD = 0.5;

/** Which verdicts make the command exit with 1. `never` means a finding is never a failure. */
export type FailOn = 'block' | 'review' | 'never';

/** The command to run and its arguments. */
export type Command =
  | { readonly kind: 'check'; readonly spec: string; readonly from?: string | undefined }
  | { readonly kind: 'diff'; readonly before: string; readonly after: string }
  | { readonly kind: 'replay'; readonly file: string }
  | { readonly kind: 'demo'; readonly scenario?: string | undefined }
  | { readonly kind: 'help' };

/** Everything the command line said, checked. */
export interface CliOptions {
  readonly command: Command;
  readonly rulesOnly: boolean;
  readonly forceModels: boolean;
  readonly budgetUsd: number;
  readonly failOn: FailOn;
  readonly trace?: string | undefined;
  readonly json: boolean;
  readonly cacheDir: string;
  readonly noCache: boolean;
}

/** The command line was wrong. `problems` lists every one, so they can be fixed in one go. Exit code 2. */
export class UsageError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'UsageError';
    this.problems = problems;
  }
}

/** The help text. */
export const HELP = `pkgwarden: review npm dependency changes before they reach main.

Usage
  pkgwarden check <name[@version]> [--from <version>]
  pkgwarden diff <old-lockfile> <new-lockfile>
  pkgwarden replay <trace.jsonl>
  pkgwarden demo [scenario]          built-in fake packages and offline judges, no API key needed

Options
  --rules-only          never call a model
  --models              use models without ANTHROPIC_API_KEY (for example with an ant auth profile)
  --budget <usd>        most a run may spend (default ${DEFAULT_RUN_BUDGET_USD.toFixed(2)}, at most ${MAX_BUDGET_USD.toFixed(2)})
  --fail-on <level>     exit 1 when a verdict is at or above: block, review, or never (default)
  --trace <file>        also write every event to a JSONL file
  --json                print events as JSONL instead of the readable view
  --cache-dir <dir>     where tool results and judgments are kept (default .pkgwarden/cache)
  --no-cache            keep nothing between runs

Exit codes: 0 the review ran (findings included), 1 it failed or --fail-on was met, 2 the command was wrong.
See docs/running.md for every variable and refusal message.
`;

const OPTIONS = {
  from: { type: 'string' },
  'rules-only': { type: 'boolean', default: false },
  models: { type: 'boolean', default: false },
  budget: { type: 'string' },
  'fail-on': { type: 'string', default: 'never' },
  trace: { type: 'string' },
  json: { type: 'boolean', default: false },
  'cache-dir': { type: 'string', default: '.pkgwarden/cache' },
  'no-cache': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

const COMMANDS = ['check', 'diff', 'replay', 'demo'] as const;

function closest(word: string, candidates: readonly string[]): string | undefined {
  const best = candidates
    .map(c => ({ c, d: editDistance(word, c) }))
    .sort((a, b) => a.d - b.d)
    .at(0);
  return best && best.d <= 2 ? best.c : undefined;
}

/** Parses and checks the command line. Throws UsageError listing every problem found. */
export function parseCli(argv: readonly string[]): CliOptions {
  let parsed: ReturnType<typeof parseArgs<{ args: string[]; options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unknown = message.match(/Unknown option '(-{1,2}[\w-]+)'/)?.[1];
    if (unknown) {
      const guess = closest(unknown.replace(/^-+/, ''), Object.keys(OPTIONS));
      throw new UsageError([`${unknown} is not an option${guess ? `; did you mean --${guess}?` : ''}`]);
    }
    throw new UsageError([message]);
  }
  const { values, positionals } = parsed;
  const [name, ...args] = positionals;
  const problems: string[] = [];

  let command: Command = { kind: 'help' };
  if (values.help || name === undefined || name === 'help') {
    command = { kind: 'help' };
  } else if (name === 'check') {
    if (!args[0]) problems.push('check needs a package, for example: pkgwarden check left-pad@1.3.0');
    command = { kind: 'check', spec: args[0] ?? '', from: values.from };
  } else if (name === 'diff') {
    if (!args[0] || !args[1]) problems.push('diff needs two lockfiles: the old one, then the new one');
    command = { kind: 'diff', before: args[0] ?? '', after: args[1] ?? '' };
  } else if (name === 'replay') {
    if (!args[0]) problems.push('replay needs a trace file written with --trace');
    command = { kind: 'replay', file: args[0] ?? '' };
  } else if (name === 'demo') {
    command = { kind: 'demo', scenario: args[0] };
  } else {
    const guess = closest(name, COMMANDS);
    problems.push(`"${name}" is not a command${guess ? `; did you mean ${guess}?` : ''}`);
  }
  if (values.from !== undefined && command.kind !== 'check') problems.push('--from only works with check');

  const budgetUsd = values.budget === undefined ? DEFAULT_RUN_BUDGET_USD : Number(values.budget);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    problems.push(`--budget takes a number of dollars, for example --budget 0.25; got "${values.budget}"`);
  } else if (budgetUsd > MAX_BUDGET_USD) {
    problems.push(`--budget ${budgetUsd} is above the ceiling of ${MAX_BUDGET_USD.toFixed(2)} dollars`);
  }
  const failOn = values['fail-on'];
  if (failOn !== 'block' && failOn !== 'review' && failOn !== 'never') {
    problems.push(`--fail-on takes block, review or never; got "${failOn}"`);
  }
  if (values['rules-only'] && values.models) problems.push('--rules-only and --models cannot be used together');
  if (problems.length > 0) throw new UsageError(problems);

  return {
    command,
    rulesOnly: values['rules-only'],
    forceModels: values.models,
    budgetUsd,
    failOn: failOn as FailOn,
    trace: values.trace,
    json: values.json,
    cacheDir: values['cache-dir'],
    noCache: values['no-cache'],
  };
}
