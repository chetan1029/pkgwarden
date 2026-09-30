import { z } from 'zod';
import { ModelTier } from './agent.js';
import { CheckResult, PackageVerdict } from './verdict.js';
import { CONTRACT_VERSION } from './version.js';

/**
 * Every run is a sequence of these events. The CLI output, the PR comment, the web viewer,
 * replay and evals all read this one format, so it is the contract between the packages.
 */
const base = {
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  /** One agent invocation, for example `diff-judge#3`. Run-level events have none. */
  span: z.string().optional(),
  parentSpan: z.string().optional(),
};

/** How an agent invocation ended. Only `done` carries an output. */
export const AgentStatus = z.enum(['done', 'skipped', 'failed', 'out_of_budget', 'timeout', 'refused']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const RunEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('run.started'),
    /** The contract version that wrote this trace. Records from before the field existed parse as 1.0.0. */
    contractVersion: z.string().default(CONTRACT_VERSION),
    rootAgent: z.string(),
    label: z.string(),
    budgetUsd: z.number(),
    modelsEnabled: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('run.finished'),
    status: z.enum(['done', 'failed']),
    costUsd: z.number(),
    savedUsd: z.number(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('agent.started'),
    agentId: z.string(),
    agentVersion: z.string(),
    kind: z.enum(['code', 'model']),
    label: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('agent.finished'),
    agentId: z.string(),
    status: AgentStatus,
    costUsd: z.number(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal('agent.skipped'), agentId: z.string(), reason: z.string() }),
  z.object({ ...base, type: z.literal('agent.refused'), agentId: z.string(), reason: z.string() }),
  z.object({ ...base, type: z.literal('tool.called'), tool: z.string(), inputHash: z.string() }),
  z.object({
    ...base,
    type: z.literal('tool.result'),
    tool: z.string(),
    outputHash: z.string(),
    bytes: z.number().int(),
    cached: z.boolean(),
    durationMs: z.number(),
  }),
  z.object({ ...base, type: z.literal('tool.refused'), tool: z.string(), reason: z.string() }),
  z.object({ ...base, type: z.literal('tool.failed'), tool: z.string(), error: z.string() }),
  z.object({
    ...base,
    type: z.literal('model.requested'),
    tier: ModelTier,
    model: z.string(),
    requestHash: z.string(),
    reservedUsd: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal('model.completed'),
    model: z.string(),
    servedBy: z.string(),
    requestHash: z.string(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    durationMs: z.number(),
    stopReason: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal('model.reused'),
    model: z.string(),
    requestHash: z.string(),
    savedUsd: z.number(),
    originalRunId: z.string().optional(),
    storedAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('model.fallback'),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('model.failed'),
    model: z.string(),
    error: z.string(),
    retryable: z.boolean(),
  }),
  z.object({ ...base, type: z.literal('model.invalid_output'), model: z.string(), issues: z.string() }),
  z.object({
    ...base,
    type: z.literal('budget.exceeded'),
    scope: z.string(),
    neededUsd: z.number(),
    remainingUsd: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal('limit.reached'),
    limit: z.enum(['time', 'steps']),
    scope: z.string(),
    detail: z.string(),
  }),
  z.object({ ...base, type: z.literal('check.result'), target: z.string(), result: CheckResult }),
  z.object({ ...base, type: z.literal('verdict'), result: PackageVerdict }),
  z.object({ ...base, type: z.literal('note'), message: z.string() }),
]);
/** One event as stored in a trace, after defaults are applied. */
export type RunEvent = z.output<typeof RunEvent>;
/** The `type` field of every event. */
export type RunEventType = RunEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What callers pass to `emit`: the engine fills in runId, seq, ts and spans. */
export type RunEventPayload = DistributiveOmit<
  z.input<typeof RunEvent>,
  'runId' | 'seq' | 'ts' | 'span' | 'parentSpan'
>;
