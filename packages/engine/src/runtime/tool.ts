import { ToolId } from '@pkgwarden/contracts';
import type { z } from 'zod';

/** How long a tool's results may be reused. */
export type CachePolicy =
  /** Always fetch fresh, for data that can change any minute (vulnerability reports). */
  | { readonly kind: 'none' }
  /** Reuse for a while (package metadata, GitHub activity). */
  | { readonly kind: 'ttl'; readonly ttlMs: number }
  /** Content-addressed data that can never change (a tarball with a known integrity hash). */
  | { readonly kind: 'immutable' };

/** What a tool gets when it runs: a signal that fires on the agent's deadline. */
export interface ToolContext {
  readonly signal: AbortSignal;
}

/** One tool. Input and output are checked against their schemas on every call, cached or not. */
export interface ToolSpec<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly id: ToolId;
  /** Shown to model agents that are allowed to use this tool. */
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly cache: CachePolicy;
  /** Defaults to the whole input. */
  cacheKey?(input: z.output<I>): unknown;
  run(input: z.output<I>, ctx: ToolContext): Promise<z.input<O>>;
}

/** Any tool, whatever its schemas. */
export type AnyTool = ToolSpec<z.ZodType, z.ZodType>;

/** Defines a tool. Refuses an id that is not `source.name`. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(spec: ToolSpec<I, O>): ToolSpec<I, O> {
  ToolId.parse(spec.id);
  return spec;
}

/** Model APIs only allow [a-zA-Z0-9_-] in tool names, so `github.recentIssues` becomes `github__recentIssues`. */
export function toolApiName(id: string): string {
  return id.replace('.', '__');
}
