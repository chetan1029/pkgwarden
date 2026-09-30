import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type PackageVerdict, reduce } from '@pkgwarden/contracts';
import { anthropicTiers, log, MemoryStore, type ModelTiers } from '@pkgwarden/engine';
import { createReviewer, ROOT_AGENT } from '@pkgwarden/review';
import { ALL_FIXTURE_PACKAGES, EVAL_NOW, fixtureHttp, offlineModels, SCENARIOS } from '@pkgwarden/review/scenarios';

/*
 * Runs every scenario through the full reviewer and compares verdicts.
 * Offline (default): scripted judges, so it checks the plumbing and costs nothing.
 * --live: real models on the same fake packages, which is what the nightly job runs.
 * Each suite runs twice on one cache, to show that the second pass reuses every judgment.
 */

interface Row {
  readonly scenario: string;
  readonly expected: string;
  readonly got: string;
  readonly ok: boolean;
  readonly modelCalls: number;
  readonly costUsd: number;
  readonly reason: string;
}

interface Pass {
  readonly rows: readonly Row[];
  readonly costUsd: number;
  readonly savedUsd: number;
  readonly reused: number;
}

const print = (line = ''): void => void process.stdout.write(`${line}\n`);
const pad = (s: string, n: number): string => s.slice(0, n).padEnd(n);

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    'min-accuracy': { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});

const minAccuracy = Number(values['min-accuracy'] ?? (values.live ? 0.85 : 1));
if (!Number.isFinite(minAccuracy) || minAccuracy < 0 || minAccuracy > 1) {
  process.stderr.write(`--min-accuracy takes a number from 0 to 1; got "${values['min-accuracy']}"\n`);
  process.exit(2);
}
if (values.live && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  log.warn('live evals without ANTHROPIC_API_KEY: the SDK will look for an ant auth profile');
}

const models: ModelTiers = values.live ? anthropicTiers() : offlineModels(EVAL_NOW);
const reviewer = createReviewer({
  http: fixtureHttp(ALL_FIXTURE_PACKAGES),
  store: new MemoryStore(() => EVAL_NOW),
  models,
  budgetUsd: 1,
  clock: () => EVAL_NOW,
});

async function pass(): Promise<Pass> {
  const rows: Row[] = [];
  let costUsd = 0;
  let savedUsd = 0;
  let reused = 0;
  for (const scenario of SCENARIOS) {
    const result = await reviewer.run<{ verdicts: PackageVerdict[] }>(
      ROOT_AGENT,
      { targets: [scenario.target] },
      { label: scenario.id }
    );
    const view = reduce(result.events);
    const verdict = result.outcome.status === 'done' ? result.outcome.output.verdicts[0] : undefined;
    rows.push({
      scenario: scenario.id,
      expected: scenario.expected,
      got: verdict?.verdict ?? `failed: ${result.outcome.status}`,
      ok: verdict?.verdict === scenario.expected,
      modelCalls: view.modelCalls,
      costUsd: result.costUsd,
      reason: verdict?.reasons[0] ?? '',
    });
    costUsd += result.costUsd;
    savedUsd += result.savedUsd;
    reused += view.reusedCalls;
  }
  log.info('eval pass finished', { scenarios: rows.length, cost_usd: costUsd, reused });
  return { rows, costUsd, savedUsd, reused };
}

const first = await pass();
const second = await pass();
const correct = first.rows.filter(r => r.ok).length;
const accuracy = correct / first.rows.length;

print(`pkgwarden evals · ${values.live ? 'live models' : 'offline judges'} · ${SCENARIOS.length} scenarios`);
print();
print(`${pad('scenario', 22)}${pad('expected', 10)}${pad('got', 11)}${pad('model', 7)}${pad('cost', 10)}first reason`);
for (const r of first.rows) {
  const got = `${r.ok ? '✓' : '✗'} ${r.got}`;
  print(
    `${pad(r.scenario, 22)}${pad(r.expected, 10)}${pad(got, 11)}${pad(String(r.modelCalls), 7)}${pad(`$${r.costUsd.toFixed(4)}`, 10)}${r.reason.slice(0, 70)}`
  );
}
print();
print(`accuracy ${correct}/${first.rows.length} (${(accuracy * 100).toFixed(0)}%), spent $${first.costUsd.toFixed(4)}`);
print(
  `second pass on the same cache: spent $${second.costUsd.toFixed(4)}, reused ${second.reused} judgments, saved $${second.savedUsd.toFixed(4)}`
);

if (values.out) {
  await mkdir(dirname(values.out), { recursive: true });
  const report = {
    mode: values.live ? 'live' : 'offline',
    ranAt: new Date().toISOString(),
    accuracy,
    costUsd: first.costUsd,
    rows: first.rows,
    secondPass: { costUsd: second.costUsd, reused: second.reused, savedUsd: second.savedUsd },
  };
  await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
}

if (accuracy < minAccuracy) {
  log.error('accuracy is below the minimum', { accuracy, min_accuracy: minAccuracy });
  process.exitCode = 1;
}
