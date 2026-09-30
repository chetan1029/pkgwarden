import type Anthropic from '@anthropic-ai/sdk';
import type { ModelTier } from '@pkgwarden/contracts';

/** How hard the model thinks. Only some models accept it. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** One model and its price. Holds no credentials: the SDK reads them from the environment when it calls. */
export interface ModelConfig {
  /** Exact model id sent to the API, for example `claude-haiku-4-5`. */
  readonly id: string;
  readonly tier: ModelTier;
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
  readonly effort?: Effort | undefined;
  /** Ask the API to re-run a safety decline on another model (`fallbacks: "default"`). */
  readonly serverFallbacks?: boolean | undefined;
}

/** Exactly what is sent for one model turn. Its hash is the cache key. */
export interface ModelRequest {
  readonly system: string;
  readonly messages: Anthropic.Beta.BetaMessageParam[];
  readonly tools: Anthropic.Beta.BetaTool[];
  /** JSON schema the final answer must follow (structured outputs). */
  readonly outputSchema: Record<string, unknown>;
  readonly maxOutputTokens: number;
}

/** What one model turn returned. */
export interface ModelResponse {
  readonly content: Anthropic.Beta.BetaContentBlock[];
  readonly stopReason: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The model that actually answered. Differs from the config when a server-side fallback ran. */
  readonly servedBy: string;
}

/** Calls one model. Throws ModelCallError, marked retryable or not. */
export interface ModelClient {
  readonly config: ModelConfig;
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

/** Clients per tier, tried in order. The second one is the fallback when the first fails in a retryable way. */
export type ModelTiers = Partial<Record<ModelTier, ModelClient[]>>;
