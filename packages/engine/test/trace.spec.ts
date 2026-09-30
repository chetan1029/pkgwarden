import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunEvent } from '@pkgwarden/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlFileSink, parseTrace, TraceReadError } from '../src/index.js';
import { makeEngine } from './support.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pkgwarden-trace-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('traces', () => {
  it('writes every event as a line that parses against the contract, in order', async () => {
    const path = join(dir, 'run.jsonl');
    const sink = new JsonlFileSink(path);
    const result = await makeEngine().run('root', { text: 'x' }, { sinks: [sink] });
    await sink.close();
    const { events } = parseTrace(await readFile(path, 'utf8'));
    expect(events.map(e => e.seq)).toEqual(result.events.map(e => e.seq));
    expect(events.every(e => RunEvent.safeParse(e).success)).toBe(true);
    expect(events[0]).toMatchObject({ type: 'run.started', contractVersion: '1.0.0' });
  });

  it('drops a half-written last line', async () => {
    const result = await makeEngine().run('root', { text: 'x' });
    const text = `${result.events.map(e => JSON.stringify(e)).join('\n')}\n{"runId":"r","se`;
    const parsed = parseTrace(text);
    expect(parsed.droppedLastLine).toBe(true);
    expect(parsed.events).toHaveLength(result.events.length);
  });

  it('refuses a broken line in the middle, with its line number', async () => {
    const result = await makeEngine().run('root', { text: 'x' });
    const lines = result.events.map(e => JSON.stringify(e));
    lines.splice(1, 0, 'not json');
    expect(() => parseTrace(lines.join('\n'))).toThrow(TraceReadError);
    expect(() => parseTrace(lines.join('\n'))).toThrow('line 2 is not valid JSON');
  });

  it('reads traces written before contractVersion existed', () => {
    const old = {
      runId: 'r',
      seq: 0,
      ts: '2026-09-25T00:00:00Z',
      type: 'run.started',
      rootAgent: 'root',
      label: 'x',
      budgetUsd: 1,
      modelsEnabled: false,
    };
    expect(parseTrace(JSON.stringify(old)).events[0]).toMatchObject({ contractVersion: '1.0.0' });
  });
});
