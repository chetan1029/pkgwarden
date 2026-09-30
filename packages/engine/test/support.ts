import { z } from 'zod';
import {
  defineCodeAgent,
  defineModelAgent,
  defineTool,
  Engine,
  type EngineOptions,
  MemoryStore,
  type AnyTool,
  type ModelClient,
  type ModelConfig,
  type ModelRequest,
  scriptedModel,
} from '../src/index.js';

export const TEST_SMALL: ModelConfig = { id: 'test-small', tier: 'small', inputUsdPerMTok: 1, outputUsdPerMTok: 5 };
export const TEST_LARGE: ModelConfig = { id: 'test-large', tier: 'large', inputUsdPerMTok: 5, outputUsdPerMTok: 25 };

export const Answer = z.object({ risk: z.enum(['low', 'high']), summary: z.string() });
export type Answer = z.infer<typeof Answer>;

/** Two tools that count how often they really ran: one cached for a minute, one never cached. */
export function makeTools(): { calls: { echo: number; fresh: number }; tools: AnyTool[] } {
  const calls = { echo: 0, fresh: 0 };
  const echo = defineTool({
    id: 'demo.echo',
    description: 'Returns the text it was given',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    cache: { kind: 'ttl', ttlMs: 60_000 },
    async run(input) {
      calls.echo++;
      return { text: input.text };
    },
  });
  const fresh = defineTool({
    id: 'demo.fresh',
    description: 'Never cached',
    input: z.object({}),
    output: z.object({ n: z.number() }),
    cache: { kind: 'none' },
    async run() {
      calls.fresh++;
      return { n: calls.fresh };
    },
  });
  return { calls, tools: [echo, fresh] };
}

export const judge = defineModelAgent({
  def: {
    id: 'judge',
    version: '1',
    description: 'test judge',
    tools: ['demo.echo'],
    budget: { maxSteps: 6, maxUsd: 0.05, timeoutMs: 5_000, maxOutputTokens: 1000 },
    model: { tier: 'small' },
  },
  input: z.object({ text: z.string() }),
  output: Answer,
  prompt: input => ({ system: 'You judge text.', user: input.text }),
});

export const root = defineCodeAgent({
  def: {
    id: 'root',
    version: '1',
    description: 'calls a tool, then the judge',
    tools: ['demo.echo', 'demo.fresh'],
    agents: ['judge'],
    budget: { maxSteps: 10, maxUsd: 0.1, timeoutMs: 5_000 },
  },
  input: z.object({ text: z.string() }),
  output: z.object({ status: z.string(), risk: z.string().optional() }),
  async run(input, ctx) {
    await ctx.callTool('demo.echo', { text: input.text });
    const outcome = await ctx.runAgent<Answer>('judge', input);
    return outcome.status === 'done' ? { status: 'done', risk: outcome.output.risk } : { status: outcome.status };
  },
});

/** A scripted small model that always answers "low". */
export const lowRiskModel = (): ModelClient & { requests: ModelRequest[] } =>
  scriptedModel(TEST_SMALL, () => ({ output: { risk: 'low', summary: 'fine' } }));

/** An engine with the test tools and agents; anything can be overridden. */
export function makeEngine(overrides: Partial<EngineOptions> = {}): Engine {
  return new Engine({
    tools: makeTools().tools,
    agents: [root, judge],
    store: new MemoryStore(),
    budgetUsd: 0.2,
    models: { small: [lowRiskModel()] },
    ...overrides,
  });
}
