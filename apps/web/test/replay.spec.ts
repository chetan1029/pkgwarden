import type { RunEvent } from '@pkgwarden/contracts';
import { describe, expect, it } from 'vitest';
import { delayFor, logLines, waitingOn } from '../src/lib/replay.js';

const base = { runId: 'r', ts: '2026-09-20T12:00:00.000Z' };
const events: RunEvent[] = [
  {
    ...base,
    seq: 0,
    type: 'run.started',
    contractVersion: '1.0.0',
    rootAgent: 'root',
    label: 'x',
    budgetUsd: 1,
    modelsEnabled: true,
  },
  { ...base, seq: 1, span: 'judge#1', type: 'tool.called', tool: 'demo.echo', inputHash: 'h' },
  {
    ...base,
    seq: 2,
    span: 'judge#1',
    type: 'model.requested',
    tier: 'small',
    model: 'm',
    requestHash: 'h',
    reservedUsd: 0.01,
  },
];

describe('replay', () => {
  it('leaves bookkeeping events out of the log', () => {
    expect(logLines(events, events.length).map(l => l.seq)).toEqual([0, 2]);
  });

  it('only shows what has been reached so far', () => {
    expect(logLines(events, 1)).toHaveLength(1);
  });

  it('says which model an agent is waiting on, and only while the answer is missing', () => {
    expect(waitingOn(events, 3)).toEqual({ span: 'judge#1', model: 'm' });
    expect(waitingOn(events, 2)).toBeUndefined();
  });

  it('holds on a model answer longer than on a tool call, so a reader can follow', () => {
    const answer = { ...base, seq: 3, type: 'model.completed' } as RunEvent;
    expect(delayFor(answer)).toBeGreaterThan(delayFor(events[1] as RunEvent));
  });
});
