import { z } from 'zod';
import { AgentId, ToolId } from './ids.js';

/** `small` does the reading; `large` is only asked to confirm a block. */
export const ModelTier = z.enum(['small', 'large']);
/** `small` does the reading; `large` is only asked to confirm a block. */
export type ModelTier = z.infer<typeof ModelTier>;

/** An agent's limits. Every one is a ceiling: a run may lower them, never raise them. */
export const Budget = z
  .object({
    /** Tool calls plus model turns this agent may make. */
    maxSteps: z.number().int().positive(),
    /** Spending cap in USD. It is also capped by whatever the parent has left. */
    maxUsd: z.number().nonnegative(),
    timeoutMs: z.number().int().positive(),
    /** Model agents only: the max_tokens sent with each model turn. */
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();
/** An agent's limits. Every one is a ceiling: a run may lower them, never raise them. */
export type Budget = z.infer<typeof Budget>;

/**
 * Everything that makes one agent different from another lives here, as data.
 * The engine checks it before a run starts and enforces it while the agent runs.
 */
export const AgentDef = z
  .object({
    id: AgentId,
    /** Bump when behaviour changes. It is part of every trace event and cache key. */
    version: z.string().min(1),
    description: z.string(),
    kind: z.enum(['code', 'model']),
    /** The only tools this agent may call. */
    tools: z.array(ToolId).default([]),
    /** The only sub-agents this agent may start. */
    agents: z.array(AgentId).default([]),
    budget: Budget,
    model: z.object({ tier: ModelTier }).strict().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.kind !== 'model') return;
    if (d.model === undefined)
      ctx.addIssue({ code: 'custom', path: ['model'], message: `model agent "${d.id}" needs model.tier` });
    if (d.budget.maxOutputTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['budget', 'maxOutputTokens'],
        message: `model agent "${d.id}" needs budget.maxOutputTokens`,
      });
    }
  });
/** An agent definition after defaults are applied. */
export type AgentDef = z.output<typeof AgentDef>;
/** An agent definition as written, before defaults. */
export type AgentDefInput = z.input<typeof AgentDef>;
