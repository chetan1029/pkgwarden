import { readFile } from 'node:fs/promises';
import { type PackageTarget, type PackageVerdict, reduce, targetLabel, type Verdict } from '@pkgwarden/contracts';
import {
  anthropicTiers,
  callbackSink,
  type EventSink,
  FileStore,
  JsonlFileSink,
  log,
  MemoryStore,
  type ModelTiers,
  parseTrace,
} from '@pkgwarden/engine';
import { createReviewer, diffLockfiles, liveHttp, parseLockfile, parseSpec, ROOT_AGENT } from '@pkgwarden/review';
import { ALL_FIXTURE_PACKAGES, EVAL_NOW, fixtureHttp, offlineModels, SCENARIOS } from '@pkgwarden/review/scenarios';
import { type CliOptions, HELP, MAX_BUDGET_USD, UsageError } from './args.js';
import { formatEvent, formatSummary } from './render.js';

/** Where the command writes. Stdout is the program's output; stderr is for logs and usage text. */
export interface Output {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const RANK: Record<Verdict, number> = { allow: 0, review: 1, undecided: 1, block: 2 };

/** Runs one command and returns its exit code: 0 it ran, 1 it failed or --fail-on was met. */
export async function runCommand(options: CliOptions, out: Output): Promise<number> {
  const { command } = options;
  if (command.kind === 'help') {
    out.stdout(HELP);
    return 0;
  }
  if (command.kind === 'replay') return replay(command.file, out);

  let targets: PackageTarget[];
  if (command.kind === 'demo') {
    const scenario = SCENARIOS.find(s => s.id === command.scenario);
    if (!scenario) {
      if (command.scenario !== undefined) {
        throw new UsageError([`"${command.scenario}" is not a scenario; run pkgwarden demo to list them`]);
      }
      out.stdout('Built-in scenarios. All packages are fake, and nothing is downloaded or run.\n\n');
      for (const s of SCENARIOS) out.stdout(`  ${s.id.padEnd(22)} ${s.description}\n`);
      out.stdout('\nRun one with: pkgwarden demo postinstall-exfil\n');
      return 0;
    }
    targets = [scenario.target];
  } else if (command.kind === 'check') {
    const { name, version } = parseSpec(command.spec);
    targets = [{ name, ...(version ? { to: version } : {}), ...(command.from ? { from: command.from } : {}) }];
  } else {
    const [before, after] = await Promise.all([readFile(command.before, 'utf8'), readFile(command.after, 'utf8')]);
    targets = diffLockfiles(parseLockfile(command.before, before), parseLockfile(command.after, after));
    if (targets.length === 0) {
      out.stdout('No new or changed packages between the two lockfiles.\n');
      return 0;
    }
  }

  const reviewer =
    command.kind === 'demo'
      ? createReviewer({
          http: fixtureHttp(ALL_FIXTURE_PACKAGES),
          store: new MemoryStore(() => EVAL_NOW),
          models: options.rulesOnly ? undefined : offlineModels(EVAL_NOW),
          budgetUsd: MAX_BUDGET_USD,
          clock: () => EVAL_NOW,
        })
      : createReviewer({
          http: liveHttp(),
          store: options.noCache ? new MemoryStore() : new FileStore(options.cacheDir),
          models: pickModels(options),
          budgetUsd: MAX_BUDGET_USD,
        });

  const sinks: EventSink[] = [
    callbackSink(event => {
      if (options.json) return out.stdout(`${JSON.stringify(event)}\n`);
      const line = formatEvent(event);
      if (line !== undefined) out.stdout(`${line}\n`);
    }),
  ];
  const trace = options.trace ? new JsonlFileSink(options.trace) : undefined;
  if (trace) sinks.push(trace);

  const label = targets.length === 1 ? targetLabel(targets[0] as PackageTarget) : `${targets.length} package changes`;
  const result = await reviewer.run<{ verdicts: PackageVerdict[] }>(
    ROOT_AGENT,
    { targets },
    { label, sinks, budgetUsd: options.budgetUsd }
  );
  await trace?.close();
  if (!options.json) out.stdout(`${formatSummary(reduce(result.events))}\n`);
  if (result.outcome.status !== 'done') return 1;
  if (options.failOn === 'never') return 0;
  const threshold = RANK[options.failOn];
  return result.outcome.output.verdicts.some(v => RANK[v.verdict] >= threshold) ? 1 : 0;
}

async function replay(file: string, out: Output): Promise<number> {
  const { events, droppedLastLine } = parseTrace(await readFile(file, 'utf8'));
  if (droppedLastLine) log.warn('trace ends with a half-written line, which was left out', { file });
  for (const event of events) {
    const line = formatEvent(event);
    if (line !== undefined) out.stdout(`${line}\n`);
  }
  out.stdout(`${formatSummary(reduce(events))}\n`);
  return 0;
}

function pickModels(options: CliOptions): ModelTiers | undefined {
  if (options.rulesOnly) return undefined;
  if (options.forceModels || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return anthropicTiers();
  log.warn('no ANTHROPIC_API_KEY, so this run uses rules only', { hint: 'pass --models to use an ant auth profile' });
  return undefined;
}
