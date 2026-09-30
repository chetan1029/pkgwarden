import { reduce } from '@pkgwarden/contracts';
import { describe, expect, it } from 'vitest';
import { Engine, MemoryStore, scriptedModel } from '../src/index.js';
import { judge, lowRiskModel, makeEngine, makeTools, root, TEST_SMALL } from './support.js';

describe('tool cache', () => {
  it('reuses ttl tools and always refetches uncached ones', async () => {
    const { calls, tools } = makeTools();
    const engine = new Engine({
      tools,
      agents: [root, judge],
      store: new MemoryStore(),
      budgetUsd: 0.2,
      models: { small: [lowRiskModel()] },
    });
    await engine.run('root', { text: 'same' });
    const second = await engine.run('root', { text: 'same' });
    expect(second.events.filter(e => e.type === 'tool.result' && e.cached)).toHaveLength(1);
    expect(calls.echo).toBe(1);
  });
});

describe('judgment cache', () => {
  it('reuses a judgment for the exact same request and reports the saving', async () => {
    const model = lowRiskModel();
    const engine = makeEngine({ models: { small: [model] } });
    const first = await engine.run('root', { text: 'same input' });
    const second = await engine.run('root', { text: 'same input' });
    expect(model.requests).toHaveLength(1);
    expect(first.costUsd).toBeGreaterThan(0);
    expect(second.costUsd).toBe(0);
    expect(second.savedUsd).toBeCloseTo(first.costUsd);
    expect(second.events.find(e => e.type === 'model.reused')).toMatchObject({ originalRunId: first.runId });
    expect(reduce(second.events)).toMatchObject({ reusedCalls: 1, modelCalls: 0, status: 'done' });
  });

  it('asks again when the input changes', async () => {
    const model = lowRiskModel();
    const engine = makeEngine({ models: { small: [model] } });
    await engine.run('root', { text: 'one' });
    await engine.run('root', { text: 'two' });
    expect(model.requests).toHaveLength(2);
  });

  it('never caches an answer that failed the schema', async () => {
    const store = new MemoryStore();
    const sloppy = scriptedModel(TEST_SMALL, () => ({ text: 'not json' }));
    await makeEngine({ store, models: { small: [sloppy] } }).run('judge', { text: 'x' });
    expect(store.size).toBe(0);
  });
});
