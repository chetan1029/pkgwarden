import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, type PackageVerdict, reduce, targetLabel } from '@pkgwarden/contracts';
import { log, MemoryStore } from '@pkgwarden/engine';
import { createReviewer, ROOT_AGENT } from '@pkgwarden/review';
import { ALL_FIXTURE_PACKAGES, EVAL_NOW, fixtureHttp, offlineModels, SCENARIOS } from '@pkgwarden/review/scenarios';
import { type TraceEntry, TraceIndex } from '../src/lib/catalog.js';

/*
 * Records every scenario twice on one cache: once cold, once warm, so the site can show that a
 * repeated review reuses every judgment and costs nothing. Offline judges, fixed clock, fixed run ids.
 */
const out = fileURLToPath(new URL('../public/traces/', import.meta.url));
await mkdir(out, { recursive: true });

// Each file is swapped in whole, so a dev server reading the folder never sees it half written or empty.
const written = new Set<string>();
async function put(name: string, content: string): Promise<void> {
  const tmp = `${out}.${name}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, `${out}${name}`);
  written.add(name);
}

const toJsonl = (events: readonly unknown[]) => events.map(e => JSON.stringify(e)).join('\n') + '\n';
const entries: TraceEntry[] = [];

for (const scenario of SCENARIOS) {
  const reviewer = createReviewer({
    http: fixtureHttp(ALL_FIXTURE_PACKAGES),
    store: new MemoryStore(() => EVAL_NOW),
    models: offlineModels(EVAL_NOW),
    clock: () => EVAL_NOW,
  });
  const label = targetLabel(scenario.target);
  const input = { targets: [scenario.target] };
  const first = await reviewer.run<{ verdicts: PackageVerdict[] }>(ROOT_AGENT, input, {
    runId: `${scenario.id}-first`,
    label,
  });
  const second = await reviewer.run<{ verdicts: PackageVerdict[] }>(ROOT_AGENT, input, {
    runId: `${scenario.id}-second`,
    label,
  });
  if (first.outcome.status !== 'done') throw new Error(`${scenario.id} failed: ${first.outcome.error}`);
  const verdict = first.outcome.output.verdicts[0];
  if (!verdict) throw new Error(`${scenario.id} returned no verdict`);

  const files = { first: `${scenario.id}-first.jsonl`, second: `${scenario.id}-second.jsonl` };
  await put(files.first, toJsonl(first.events));
  await put(files.second, toJsonl(second.events));
  entries.push({
    id: scenario.id,
    description: scenario.description,
    label: verdict.from ? `${verdict.name} ${verdict.from} → ${verdict.to}` : `${verdict.name}@${verdict.to}`,
    expected: scenario.expected,
    verdict: verdict.verdict,
    costUsd: first.costUsd,
    modelCalls: reduce(first.events).modelCalls,
    files,
  });
}

const index = TraceIndex.parse({ contractVersion: CONTRACT_VERSION, judges: 'offline', scenarios: entries });
await put('index.json', `${JSON.stringify(index, null, 2)}\n`);
for (const name of await readdir(out)) {
  if (!written.has(name)) await rm(`${out}${name}`, { force: true });
}
log.info('traces recorded', { scenarios: entries.length, dir: 'public/traces' });
