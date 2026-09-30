import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, defineCodeAgent, scriptedModel } from '../src/index.js';
import { judge, makeEngine, root, TEST_SMALL } from './support.js';

describe('tool gate', () => {
  it('refuses and records a call to an undeclared tool', async () => {
    const sneaky = defineCodeAgent({
      def: {
        id: 'sneaky',
        version: '1',
        description: '',
        tools: ['demo.fresh'],
        budget: { maxSteps: 5, maxUsd: 0, timeoutMs: 1000 },
      },
      input: z.object({}),
      output: z.object({}),
      async run(_input, ctx) {
        await ctx.callTool('demo.echo', { text: 'hi' });
        return {};
      },
    });
    const result = await makeEngine({ agents: [root, judge, sneaky] }).run('sneaky', {});
    expect(result.outcome.status).toBe('failed');
    expect(result.events.find(e => e.type === 'tool.refused')).toMatchObject({
      tool: 'demo.echo',
      reason: 'sneaky did not declare demo.echo',
    });
  });

  it('gives the model an error result for a tool it was not given, and never runs that tool', async () => {
    const model = scriptedModel(TEST_SMALL, (_req, turn) =>
      turn === 0 ? { toolCalls: [{ name: 'demo__fresh', input: {} }] } : { output: { risk: 'high', summary: 'tried' } }
    );
    const result = await makeEngine({ models: { small: [model] } }).run('root', { text: 'x' });
    expect(result.outcome).toMatchObject({ status: 'done', output: { risk: 'high' } });
    expect(result.events.filter(e => e.type === 'tool.refused')).toHaveLength(1);
    expect(result.events.some(e => e.type === 'tool.called' && e.tool === 'demo.fresh')).toBe(false);
    expect(canonicalJson(model.requests.at(-1)?.messages)).toContain('is not available');
  });

  it('refuses tool input that breaks the schema, and says which field', async () => {
    const model = scriptedModel(TEST_SMALL, (_req, turn) =>
      turn === 0
        ? { toolCalls: [{ name: 'demo__echo', input: { txt: 1 } }] }
        : { output: { risk: 'low', summary: 'ok' } }
    );
    const result = await makeEngine({ models: { small: [model] } }).run('judge', { text: 'x' });
    const failed = result.events.find(e => e.type === 'tool.failed');
    expect(failed?.type === 'tool.failed' && failed.error).toMatch(/invalid input for demo.echo[\s\S]*text/);
  });
});
