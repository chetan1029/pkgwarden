import { gzipSync } from 'node:zlib';
import type { PackageVerdict, RunEvent } from '@pkgwarden/contracts';
import { MemoryStore, type RunResult } from '@pkgwarden/engine';
import { createReviewer, ROOT_AGENT } from '../src/index.js';
import { EVAL_NOW, fixtureHttp, offlineModels, type Scenario, SCENARIOS } from '../src/scenarios/index.js';

/** A gzipped tar with hand-written headers, for entries createTarGz would never produce (links, `..`). */
export function tarWith(entries: readonly { name: string; type?: string; body?: string }[]): Uint8Array {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.body ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('        ', 148);
    h.write(e.type ?? '0', 156);
    h.write('ustar\0', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export interface ScenarioRun {
  readonly scenario: Scenario;
  readonly result: RunResult<{ verdicts: PackageVerdict[] }>;
  readonly verdict: PackageVerdict;
  readonly events: readonly RunEvent[];
}

/** Runs one scenario through the whole reviewer, with offline judges or in rules-only mode. */
export async function reviewScenario(id: string, options: { withModels?: boolean } = {}): Promise<ScenarioRun> {
  const scenario = SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const engine = createReviewer({
    http: fixtureHttp(scenario.packages),
    store: new MemoryStore(),
    models: options.withModels === false ? undefined : offlineModels(),
    clock: () => EVAL_NOW,
  });
  const result = await engine.run<{ verdicts: PackageVerdict[] }>(ROOT_AGENT, { targets: [scenario.target] });
  if (result.outcome.status !== 'done') throw new Error(`run failed: ${result.outcome.error}`);
  return { scenario, result, verdict: result.outcome.output.verdicts[0] as PackageVerdict, events: result.events };
}
