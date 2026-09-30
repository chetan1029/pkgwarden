import { AgentDef } from '@pkgwarden/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCodeAgent, EngineConfigError } from '../src/index.js';
import { makeEngine } from './support.js';

describe('preflight', () => {
  it('refuses an agent that declares a tool the deployment does not allow', () => {
    expect(() => makeEngine({ allowedTools: ['demo.fresh'] })).toThrow(
      /root declares demo.echo, which this deployment does not allow/
    );
  });

  it('lists every problem at once, so they can be fixed in one pass', () => {
    const bad = defineCodeAgent({
      def: {
        id: 'bad',
        version: '1',
        description: '',
        tools: ['demo.nope'],
        agents: ['ghost'],
        budget: { maxSteps: 1, maxUsd: 0, timeoutMs: 1000 },
      },
      input: z.object({}),
      output: z.object({}),
      run: async () => ({}),
    });
    try {
      makeEngine({ agents: [bad] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EngineConfigError);
      expect((err as EngineConfigError).problems).toEqual([
        'bad declares unknown tool demo.nope',
        'bad declares unknown sub-agent ghost',
      ]);
    }
  });

  it('refuses a negative budget', () => {
    expect(() => makeEngine({ budgetUsd: -1 })).toThrow(/budgetUsd must be a positive number/);
  });

  it('refuses a model agent without max output tokens, naming the field', () => {
    const result = AgentDef.safeParse({
      id: 'judge',
      version: '1',
      description: '',
      kind: 'model',
      model: { tier: 'small' },
      budget: { maxSteps: 1, maxUsd: 0.01, timeoutMs: 1000 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('model agent "judge" needs budget.maxOutputTokens');
  });

  it('refuses unknown keys in an agent definition instead of ignoring them', () => {
    const result = AgentDef.safeParse({
      id: 'x',
      version: '1',
      description: '',
      kind: 'code',
      budget: { maxSteps: 1, maxUsd: 0, timeoutMs: 1000, maxStep: 3 },
    });
    expect(result.success).toBe(false);
  });
});
