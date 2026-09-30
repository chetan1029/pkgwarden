import { AgentDef, type AgentDefInput, type AgentStatus, type RunEventPayload } from '@pkgwarden/contracts';
import type { z } from 'zod';

/** How an agent invocation ended. Only `done` carries an output; everything else says why not. */
export type AgentOutcome<O> =
  | { readonly status: 'done'; readonly output: O }
  | { readonly status: Exclude<AgentStatus, 'done'>; readonly error?: string | undefined };

/** Events an agent may emit itself. Everything else is emitted by the engine. */
export type AgentEmittable = Extract<RunEventPayload, { type: 'check.result' | 'verdict' | 'note' | 'agent.skipped' }>;

/** What a code agent gets from the engine. It is the agent's only way to reach anything. */
export interface AgentContext {
  readonly signal: AbortSignal;
  readonly span: string;
  /** False in rules-only mode, or when no model is configured for a tier. */
  readonly modelsEnabled: boolean;
  /** The engine's clock. Rules use it instead of Date.now() so replays and fixtures stay deterministic. */
  readonly now: () => Date;
  /** Runs a tool this agent declared. Anything else is refused and recorded. */
  callTool<T = unknown>(id: string, input: unknown): Promise<T>;
  /** Starts a sub-agent this agent declared. Never throws: failures come back as an outcome. */
  runAgent<T = unknown>(id: string, input: unknown, label?: string): Promise<AgentOutcome<T>>;
  emit(event: AgentEmittable): void;
}

/** An agent written as code. It can call tools and sub-agents, but only the ones it declared. */
export interface CodeAgent<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly kind: 'code';
  readonly def: AgentDef;
  readonly input: I;
  readonly output: O;
  run(input: z.output<I>, ctx: AgentContext): Promise<z.input<O>>;
}

/** The two parts of a model agent's first message. */
export interface ModelPrompt {
  readonly system: string;
  readonly user: string;
}

/** A model agent has no code of its own: the engine runs its loop, gates its tools and checks its output. */
export interface ModelAgent<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly kind: 'model';
  readonly def: AgentDef;
  readonly input: I;
  readonly output: O;
  prompt(input: z.output<I>): ModelPrompt;
}

/** Either kind of agent. */
export type AnyAgent = CodeAgent | ModelAgent;

/** Defines a code agent. Refuses a definition that does not match the AgentDef schema. */
export function defineCodeAgent<I extends z.ZodType, O extends z.ZodType>(spec: {
  readonly def: Omit<AgentDefInput, 'kind'>;
  readonly input: I;
  readonly output: O;
  run(input: z.output<I>, ctx: AgentContext): Promise<z.input<O>>;
}): CodeAgent<I, O> {
  return {
    kind: 'code',
    def: AgentDef.parse({ ...spec.def, kind: 'code' }),
    input: spec.input,
    output: spec.output,
    run: spec.run,
  };
}

/** Defines a model agent. Refuses a definition without a model tier or a max output token count. */
export function defineModelAgent<I extends z.ZodType, O extends z.ZodType>(spec: {
  readonly def: Omit<AgentDefInput, 'kind'>;
  readonly input: I;
  readonly output: O;
  prompt(input: z.output<I>): ModelPrompt;
}): ModelAgent<I, O> {
  return {
    kind: 'model',
    def: AgentDef.parse({ ...spec.def, kind: 'model' }),
    input: spec.input,
    output: spec.output,
    prompt: spec.prompt,
  };
}
