import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  type AgentDef,
  type AgentStatus,
  CONTRACT_VERSION,
  type ModelTier,
  RunEvent,
  type RunEventPayload,
} from '@pkgwarden/contracts';
import { z } from 'zod';
import type { ModelClient, ModelConfig, ModelRequest, ModelResponse, ModelTiers } from '../models/types.js';
import type { Store } from '../stores/store.js';
import type { EventSink } from '../trace/sinks.js';
import type { AgentContext, AgentOutcome, AnyAgent, ModelAgent } from './agent.js';
import { BudgetNode } from './budget.js';
import { canonicalJson, hashOf, sha256 } from './canonical.js';
import { deadline } from './deadline.js';
import {
  BudgetExceededError,
  errorMessage,
  InvalidModelOutputError,
  LimitRefusal,
  ModelCallError,
  ModelRefusalError,
  StepLimitError,
  ToolRefusedError,
} from './errors.js';
import { type AnyTool, toolApiName } from './tool.js';

/** How an engine is put together. Checked in full when the engine is built. */
export interface EngineOptions {
  readonly tools: readonly AnyTool[];
  readonly agents: readonly AnyAgent[];
  /** Leave out for rules-only mode: model agents then end as `skipped`. */
  readonly models?: ModelTiers | undefined;
  readonly store: Store;
  /**
   * The enclosure: tools this deployment may use at all. An agent that declares anything
   * outside it is refused before any run can start. Defaults to every registered tool.
   */
  readonly allowedTools?: readonly string[] | undefined;
  /** Spending cap per run in USD. It is the default and the ceiling: a run may ask for less, never more. */
  readonly budgetUsd: number;
  readonly clock?: (() => Date) | undefined;
}

/** Per-run settings. */
export interface RunOptions {
  readonly runId?: string | undefined;
  readonly label?: string | undefined;
  /** Lowers the engine's budget for this run. Asking for more than the ceiling is refused. */
  readonly budgetUsd?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly sinks?: readonly EventSink[] | undefined;
}

/** What a run did: its outcome, what it cost, what the cache saved, and every event. */
export interface RunResult<T> {
  readonly runId: string;
  readonly outcome: AgentOutcome<T>;
  readonly costUsd: number;
  readonly savedUsd: number;
  readonly events: readonly RunEvent[];
}

/** The engine's configuration is inconsistent. `problems` lists every one, so they can be fixed in one pass. */
export class EngineConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`engine configuration is invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'EngineConfigError';
    this.problems = problems;
  }
}

interface Steps {
  used: number;
  readonly max: number;
  readonly owner: string;
}

interface Frame {
  readonly agent: AnyAgent;
  readonly span: string;
  readonly parentSpan: string | undefined;
  readonly budget: BudgetNode;
  readonly signal: AbortSignal;
  readonly steps: Steps;
}

class RunState {
  readonly runId: string;
  readonly events: RunEvent[] = [];
  readonly rootBudget: BudgetNode;
  readonly signal: AbortSignal;
  savedUsd = 0;
  #seq = 0;
  readonly #counters = new Map<string, number>();
  readonly #sinks: readonly EventSink[];
  readonly #clock: () => Date;

  constructor(runId: string, budgetUsd: number, signal: AbortSignal, sinks: readonly EventSink[], clock: () => Date) {
    this.runId = runId;
    this.rootBudget = new BudgetNode('run', budgetUsd);
    this.signal = signal;
    this.#sinks = sinks;
    this.#clock = clock;
  }

  nextSpan(agentId: string): string {
    const n = (this.#counters.get(agentId) ?? 0) + 1;
    this.#counters.set(agentId, n);
    return `${agentId}#${n}`;
  }

  emit(payload: RunEventPayload, span?: string, parentSpan?: string): void {
    // Parsing every event keeps the trace honest: a malformed event is a bug, not a log line.
    const event = RunEvent.parse({
      ...payload,
      runId: this.runId,
      seq: this.#seq++,
      ts: this.#clock().toISOString(),
      span,
      parentSpan,
    });
    this.events.push(event);
    for (const sink of this.#sinks) sink.write(event);
  }
}

/**
 * Runs agents under their declared limits. Guarantees: only declared tools and sub-agents run,
 * every reservation fits every budget above it, every step is an event, and a run always closes
 * with `run.finished`, whatever went wrong inside it.
 */
export class Engine {
  readonly #tools = new Map<string, AnyTool>();
  readonly #agents = new Map<string, AnyAgent>();
  readonly #models: ModelTiers | undefined;
  readonly #store: Store;
  readonly #budgetUsd: number;
  readonly #clock: () => Date;

  /** Refuses, with every problem listed, agents that declare tools or sub-agents that do not exist or are not allowed. */
  constructor(options: EngineOptions) {
    const problems: string[] = [];
    for (const tool of options.tools) {
      if (this.#tools.has(tool.id)) problems.push(`tool ${tool.id} is registered twice`);
      this.#tools.set(tool.id, tool);
    }
    for (const agent of options.agents) {
      if (this.#agents.has(agent.def.id)) problems.push(`agent ${agent.def.id} is registered twice`);
      this.#agents.set(agent.def.id, agent);
    }
    const allowed = new Set(options.allowedTools ?? this.#tools.keys());
    for (const agent of this.#agents.values()) {
      for (const toolId of agent.def.tools) {
        if (!this.#tools.has(toolId)) problems.push(`${agent.def.id} declares unknown tool ${toolId}`);
        else if (!allowed.has(toolId)) {
          problems.push(`${agent.def.id} declares ${toolId}, which this deployment does not allow`);
        }
      }
      for (const childId of agent.def.agents) {
        if (!this.#agents.has(childId)) problems.push(`${agent.def.id} declares unknown sub-agent ${childId}`);
      }
    }
    if (!Number.isFinite(options.budgetUsd) || options.budgetUsd < 0) {
      problems.push(`budgetUsd must be a positive number of dollars, got ${options.budgetUsd}`);
    }
    if (problems.length > 0) throw new EngineConfigError(problems);
    this.#models = options.models;
    this.#store = options.store;
    this.#budgetUsd = options.budgetUsd;
    this.#clock = options.clock ?? (() => new Date());
  }

  /** True when at least one model tier has a client. */
  get modelsEnabled(): boolean {
    return Object.values(this.#models ?? {}).some(clients => clients.length > 0);
  }

  /** The ceiling a run's budget may not go over. */
  get budgetCeilingUsd(): number {
    return this.#budgetUsd;
  }

  /**
   * Runs `agentId` on `input`. Never throws for anything that happens inside the run: failures come
   * back in `outcome`. Throws `LimitRefusal` before starting if the run asks for more budget than the ceiling.
   */
  async run<T = unknown>(agentId: string, input: unknown, options: RunOptions = {}): Promise<RunResult<T>> {
    const budgetUsd = options.budgetUsd ?? this.#budgetUsd;
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
      throw new LimitRefusal(`a run budget must be a positive number of dollars, got ${budgetUsd}`);
    }
    if (budgetUsd > this.#budgetUsd) {
      const ceiling = this.#budgetUsd.toFixed(2);
      throw new LimitRefusal(
        `a run budget of $${budgetUsd.toFixed(2)} is above the ceiling of $${ceiling}; ask for $${ceiling} or less`
      );
    }
    const runId = options.runId ?? randomUUID();
    const state = new RunState(
      runId,
      budgetUsd,
      options.signal ?? new AbortController().signal,
      options.sinks ?? [],
      this.#clock
    );
    const started = Date.now();
    state.emit({
      type: 'run.started',
      contractVersion: CONTRACT_VERSION,
      rootAgent: agentId,
      label: options.label ?? agentId,
      budgetUsd,
      modelsEnabled: this.modelsEnabled,
    });
    const outcome = await this.#invoke(state, agentId, input, undefined, options.label);
    const costUsd = state.rootBudget.spentUsd;
    state.emit({
      type: 'run.finished',
      status: outcome.status === 'done' ? 'done' : 'failed',
      costUsd,
      savedUsd: state.savedUsd,
      durationMs: Date.now() - started,
      ...(outcome.status !== 'done' && outcome.error ? { error: outcome.error } : {}),
    });
    return { runId, outcome: outcome as AgentOutcome<T>, costUsd, savedUsd: state.savedUsd, events: state.events };
  }

  async #invoke(
    state: RunState,
    agentId: string,
    rawInput: unknown,
    parent: Frame | undefined,
    label: string | undefined
  ): Promise<AgentOutcome<unknown>> {
    const agent = this.#agents.get(agentId);
    if (!agent || (parent && !parent.agent.def.agents.includes(agentId))) {
      const reason = agent ? `${parent?.agent.def.id} did not declare ${agentId}` : `unknown agent ${agentId}`;
      state.emit({ type: 'agent.refused', agentId, reason }, parent?.span, parent?.parentSpan);
      return { status: 'refused', error: reason };
    }

    const span = state.nextSpan(agentId);
    const parentSpan = parent?.span;
    const budget = (parent?.budget ?? state.rootBudget).child(`agent:${span}`, agent.def.budget.maxUsd);
    const limit = deadline(agent.def.budget.timeoutMs, parent?.signal ?? state.signal);
    const frame: Frame = {
      agent,
      span,
      parentSpan,
      budget,
      signal: limit.signal,
      steps: { used: 0, max: agent.def.budget.maxSteps, owner: span },
    };
    const started = Date.now();
    state.emit(
      {
        type: 'agent.started',
        agentId,
        agentVersion: agent.def.version,
        kind: agent.kind,
        ...(label ? { label } : {}),
      },
      span,
      parentSpan
    );
    const finish = (status: AgentStatus, error?: string) =>
      state.emit(
        {
          type: 'agent.finished',
          agentId,
          status,
          costUsd: budget.spentUsd,
          durationMs: Date.now() - started,
          ...(error ? { error } : {}),
        },
        span,
        parentSpan
      );

    try {
      const input = agent.input.parse(rawInput);
      let output: unknown;
      if (agent.kind === 'code') {
        output = await agent.run(input, this.#context(state, frame));
      } else {
        const result = await this.#runModelAgent(state, agent, input, frame);
        if (result.status !== 'done') {
          finish(result.status, result.error);
          return result;
        }
        output = result.output;
      }
      const checked = agent.output.parse(output);
      finish('done');
      return { status: 'done', output: checked };
    } catch (err) {
      let status: Exclude<AgentStatus, 'done'> = 'failed';
      let message = errorMessage(err);
      if (err instanceof BudgetExceededError) {
        status = 'out_of_budget';
        state.emit(
          { type: 'budget.exceeded', scope: err.scope, neededUsd: err.neededUsd, remainingUsd: err.remainingUsd },
          span,
          parentSpan
        );
      } else if (limit.expired()) {
        status = 'timeout';
        message = `timed out after ${agent.def.budget.timeoutMs} ms`;
        state.emit({ type: 'limit.reached', limit: 'time', scope: span, detail: message }, span, parentSpan);
      } else if (err instanceof StepLimitError) {
        state.emit({ type: 'limit.reached', limit: 'steps', scope: span, detail: message }, span, parentSpan);
      } else if (err instanceof ModelRefusalError) {
        status = 'refused';
      }
      finish(status, message);
      return { status, error: message };
    } finally {
      limit.clear();
    }
  }

  #context(state: RunState, frame: Frame): AgentContext {
    return {
      signal: frame.signal,
      span: frame.span,
      modelsEnabled: this.modelsEnabled,
      now: this.#clock,
      callTool: <T>(id: string, input: unknown) => this.#callTool(state, frame, id, input) as Promise<T>,
      runAgent: <T>(id: string, input: unknown, label?: string) =>
        this.#invoke(state, id, input, frame, label) as Promise<AgentOutcome<T>>,
      emit: event => state.emit(event, frame.span, frame.parentSpan),
    };
  }

  async #callTool(state: RunState, frame: Frame, id: string, rawInput: unknown): Promise<unknown> {
    const { span, parentSpan } = frame;
    const tool = this.#tools.get(id);
    if (!tool || !frame.agent.def.tools.includes(id)) {
      const reason = `${frame.agent.def.id} did not declare ${id}`;
      state.emit({ type: 'tool.refused', tool: id, reason }, span, parentSpan);
      throw new ToolRefusedError(reason);
    }
    takeStep(frame.steps);

    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      const error = `invalid input for ${id}: ${z.prettifyError(parsed.error)}`;
      state.emit({ type: 'tool.failed', tool: id, error }, span, parentSpan);
      throw new Error(error);
    }
    const input = parsed.data;
    state.emit({ type: 'tool.called', tool: id, inputHash: hashOf(input) }, span, parentSpan);

    const started = Date.now();
    const namespace = `tool:${id}`;
    const key = hashOf({ tool: id, key: tool.cacheKey ? tool.cacheKey(input) : input });
    const report = (output: unknown, cached: boolean) => {
      const json = canonicalJson(output);
      state.emit(
        {
          type: 'tool.result',
          tool: id,
          outputHash: sha256(json),
          bytes: Buffer.byteLength(json),
          cached,
          durationMs: Date.now() - started,
        },
        span,
        parentSpan
      );
    };

    if (tool.cache.kind !== 'none') {
      const hit = await this.#store.get(namespace, key);
      if (hit) {
        const output = tool.output.parse(hit.value);
        report(output, true);
        return output;
      }
    }

    let output: unknown;
    try {
      output = tool.output.parse(await tool.run(input, { signal: frame.signal }));
    } catch (err) {
      state.emit({ type: 'tool.failed', tool: id, error: errorMessage(err) }, span, parentSpan);
      throw err;
    }
    if (tool.cache.kind !== 'none') {
      await this.#store.set(namespace, key, output, {
        ttlMs: tool.cache.kind === 'ttl' ? tool.cache.ttlMs : undefined,
      });
    }
    report(output, false);
    return output;
  }

  async #runModelAgent(
    state: RunState,
    agent: ModelAgent,
    input: unknown,
    frame: Frame
  ): Promise<AgentOutcome<unknown>> {
    const def = agent.def;
    const tier = def.model?.tier ?? 'small';
    const clients = this.#models?.[tier] ?? [];
    if (clients.length === 0) return { status: 'skipped', error: `no model configured for the ${tier} tier` };

    const { system, user } = agent.prompt(input);
    const outputSchema = jsonSchemaFor(agent.output);
    const byApiName = new Map(def.tools.map(id => [toolApiName(id), id]));
    const tools: Anthropic.Beta.BetaTool[] = def.tools.map(id => {
      const tool = this.#tools.get(id) as AnyTool;
      return { name: toolApiName(id), description: tool.description, input_schema: toolInputSchema(tool.input) };
    });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: user }];
    let repairs = 0;

    for (;;) {
      takeStep(frame.steps);
      const request: ModelRequest = {
        system,
        messages: structuredClone(messages),
        tools,
        outputSchema,
        maxOutputTokens: def.budget.maxOutputTokens ?? 2048,
      };
      const turn = await this.#callModel(state, tier, clients, request, frame, def);
      const { response } = turn;
      if (response.stopReason === 'refusal') throw new ModelRefusalError('the model declined this request');
      if (response.stopReason === 'max_tokens') {
        throw new InvalidModelOutputError('the answer was cut off at max_tokens');
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'
      );
      if (toolUses.length > 0) {
        await turn.commit();
        messages.push({ role: 'assistant', content: response.content });
        const results = await Promise.all(
          toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
            const toolId = byApiName.get(use.name);
            if (!toolId) {
              state.emit(
                { type: 'tool.refused', tool: use.name, reason: `${def.id} was not given ${use.name}` },
                frame.span,
                frame.parentSpan
              );
              return {
                type: 'tool_result',
                tool_use_id: use.id,
                is_error: true,
                content: `${use.name} is not available.`,
              };
            }
            try {
              const output = await this.#callTool(state, frame, toolId, use.input);
              return { type: 'tool_result', tool_use_id: use.id, content: canonicalJson(output) };
            } catch (err) {
              if (err instanceof StepLimitError || err instanceof BudgetExceededError || frame.signal.aborted)
                throw err;
              return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: errorMessage(err) };
            }
          })
        );
        messages.push({ role: 'user', content: results });
        continue;
      }

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');
      const parsed = parseAnswer(agent.output, text);
      if (parsed.ok) {
        await turn.commit();
        return { status: 'done', output: parsed.value };
      }
      state.emit(
        { type: 'model.invalid_output', model: turn.model, issues: parsed.issues },
        frame.span,
        frame.parentSpan
      );
      if (repairs++ >= 1) throw new InvalidModelOutputError(parsed.issues);
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: `That answer did not match the required schema (${parsed.issues}). Reply with the corrected JSON only.`,
      });
    }
  }

  async #callModel(
    state: RunState,
    tier: ModelTier,
    clients: readonly ModelClient[],
    request: ModelRequest,
    frame: Frame,
    def: AgentDef
  ): Promise<{ response: ModelResponse; model: string; commit(): Promise<void> }> {
    const { span, parentSpan } = frame;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i] as ModelClient;
      const config = client.config;
      // Hash exactly what is sent. A new prompt, schema, model or setting is a new key,
      // so the cache never needs invalidating by hand.
      const requestHash = hashOf({
        model: config.id,
        effort: config.effort ?? null,
        serverFallbacks: config.serverFallbacks ?? false,
        ...request,
      });
      const hit = await this.#store.get<ModelResponse>('model', requestHash);
      if (hit) {
        const savedUsd = typeof hit.meta?.costUsd === 'number' ? hit.meta.costUsd : 0;
        state.savedUsd += savedUsd;
        const originalRunId = typeof hit.meta?.runId === 'string' ? hit.meta.runId : undefined;
        state.emit(
          {
            type: 'model.reused',
            model: config.id,
            requestHash,
            savedUsd,
            storedAt: hit.storedAt,
            ...(originalRunId ? { originalRunId } : {}),
          },
          span,
          parentSpan
        );
        return { response: hit.value, model: config.id, commit: async () => {} };
      }

      const reservedUsd = estimateUsd(config, request);
      const reservation = frame.budget.reserve(reservedUsd);
      state.emit({ type: 'model.requested', tier, model: config.id, requestHash, reservedUsd }, span, parentSpan);
      const started = Date.now();
      let response: ModelResponse;
      try {
        response = await client.complete(request, frame.signal);
      } catch (err) {
        reservation.release();
        const retryable = err instanceof ModelCallError && err.retryable;
        state.emit({ type: 'model.failed', model: config.id, error: errorMessage(err), retryable }, span, parentSpan);
        const next = clients[i + 1];
        if (retryable && next && !frame.signal.aborted) {
          state.emit(
            { type: 'model.fallback', from: config.id, to: next.config.id, reason: errorMessage(err) },
            span,
            parentSpan
          );
          continue;
        }
        throw err;
      }
      const costUsd = actualUsd(config, response);
      reservation.settle(costUsd);
      state.emit(
        {
          type: 'model.completed',
          model: config.id,
          servedBy: response.servedBy,
          requestHash,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          costUsd,
          durationMs: Date.now() - started,
          stopReason: response.stopReason,
        },
        span,
        parentSpan
      );
      // Only answers that were used get cached: the caller commits after its own checks pass.
      return {
        response,
        model: config.id,
        commit: () =>
          this.#store.set('model', requestHash, response, {
            meta: { costUsd, runId: state.runId, model: config.id, agent: `${def.id}@${def.version}` },
          }),
      };
    }
    throw new ModelCallError('no model client available', false);
  }
}

function takeStep(steps: Steps): void {
  steps.used += 1;
  if (steps.used > steps.max) throw new StepLimitError(`${steps.owner} went over its limit of ${steps.max} steps`);
}

/** Conservative on purpose: about three characters per token, plus every output token max_tokens allows. */
export function estimateUsd(config: ModelConfig, request: ModelRequest): number {
  const chars = canonicalJson({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    schema: request.outputSchema,
  }).length;
  const inputTokens = Math.ceil(chars / 3);
  return (inputTokens * config.inputUsdPerMTok + request.maxOutputTokens * config.outputUsdPerMTok) / 1_000_000;
}

function actualUsd(config: ModelConfig, response: ModelResponse): number {
  return (response.inputTokens * config.inputUsdPerMTok + response.outputTokens * config.outputUsdPerMTok) / 1_000_000;
}

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  let json = schemaCache.get(schema);
  if (!json) {
    json = zodOutputFormat(schema).schema as Record<string, unknown>;
    schemaCache.set(schema, json);
  }
  return json;
}

function toolInputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool['input_schema'] {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { ...json, type: 'object' } as Anthropic.Beta.BetaTool['input_schema'];
}

function parseAnswer(schema: z.ZodType, text: string): { ok: true; value: unknown } | { ok: false; issues: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: 'the answer was not valid JSON' };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: z.prettifyError(result.error) };
}
