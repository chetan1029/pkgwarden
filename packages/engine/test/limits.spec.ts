import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCodeAgent, defineTool, Engine, LimitRefusal, MemoryStore, scriptedModel } from '../src/index.js';
import { lowRiskModel, makeEngine, TEST_SMALL } from './support.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('limits', () => {
  it('refuses a run budget above the ceiling before anything runs', async () => {
    await expect(makeEngine({ budgetUsd: 0.2 }).run('root', { text: 'x' }, { budgetUsd: 5 })).rejects.toThrow(
      LimitRefusal
    );
    await expect(makeEngine({ budgetUsd: 0.2 }).run('root', { text: 'x' }, { budgetUsd: 5 })).rejects.toThrow(
      'a run budget of $5.00 is above the ceiling of $0.20; ask for $0.20 or less'
    );
  });

  it('lets a run lower its budget', async () => {
    const result = await makeEngine().run('root', { text: 'x' }, { budgetUsd: 0.1 });
    expect(result.events[0]).toMatchObject({ type: 'run.started', budgetUsd: 0.1 });
  });

  it('ends as out_of_budget when the reservation does not fit, and never calls the model', async () => {
    const model = lowRiskModel();
    const result = await makeEngine({ models: { small: [model] }, budgetUsd: 0.001 }).run('root', { text: 'x' });
    expect(result.outcome).toMatchObject({ status: 'done', output: { status: 'out_of_budget' } });
    expect(model.requests).toHaveLength(0);
    expect(result.events.find(e => e.type === 'budget.exceeded')).toMatchObject({ scope: 'run' });
  });

  it('records passing the step limit once, as its own event', async () => {
    const loopy = scriptedModel(TEST_SMALL, () => ({ toolCalls: [{ name: 'demo__echo', input: { text: 'again' } }] }));
    const result = await makeEngine({ models: { small: [loopy] } }).run('judge', { text: 'x' });
    expect(result.outcome.status !== 'done' && result.outcome.error).toMatch(/limit of 6 steps/);
    expect(result.events.filter(e => e.type === 'limit.reached')).toHaveLength(1);
  });

  it('records a timeout as its own event, and the run still closes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const slow = defineTool({
      id: 'demo.slow',
      description: 'Takes a minute',
      input: z.object({}),
      output: z.object({}),
      cache: { kind: 'none' },
      run: (_input, ctx) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({}), 60_000);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(ctx.signal.reason);
          });
        }),
    });
    const waiter = defineCodeAgent({
      def: {
        id: 'waiter',
        version: '1',
        description: '',
        tools: ['demo.slow'],
        budget: { maxSteps: 2, maxUsd: 0, timeoutMs: 1_000 },
      },
      input: z.object({}),
      output: z.object({}),
      async run(_input, ctx) {
        await ctx.callTool('demo.slow', {});
        return {};
      },
    });
    const engine = new Engine({ tools: [slow], agents: [waiter], store: new MemoryStore(), budgetUsd: 0 });
    const running = engine.run('waiter', {});
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await running;
    expect(result.outcome).toMatchObject({ status: 'timeout', error: 'timed out after 1000 ms' });
    expect(result.events.filter(e => e.type === 'limit.reached')).toMatchObject([{ limit: 'time', scope: 'waiter#1' }]);
    expect(result.events.at(-1)?.type).toBe('run.finished');
  });

  it('skips model agents in rules-only mode instead of failing them', async () => {
    const result = await makeEngine({ models: undefined }).run('root', { text: 'x' });
    expect(result.outcome).toMatchObject({ status: 'done', output: { status: 'skipped' } });
  });
});
