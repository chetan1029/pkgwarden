import Anthropic from '@anthropic-ai/sdk';
import { errorMessage, ModelCallError } from '../runtime/errors.js';
import type { ModelClient, ModelConfig, ModelRequest, ModelResponse, ModelTiers } from './types.js';

/** Prices in USD per million tokens, from the Anthropic pricing table. */
export const ANTHROPIC_MODELS = {
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'claude-sonnet-5': { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  'claude-opus-5': { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
} as const;

/** Model ids with a known price. */
export type AnthropicModelId = keyof typeof ANTHROPIC_MODELS;

/** First-pass reader for the small tier. */
export const HAIKU: ModelConfig = {
  id: 'claude-haiku-4-5',
  tier: 'small',
  ...ANTHROPIC_MODELS['claude-haiku-4-5'],
};
/** Small-tier fallback when Haiku is unavailable. */
export const SONNET: ModelConfig = {
  id: 'claude-sonnet-5',
  tier: 'small',
  ...ANTHROPIC_MODELS['claude-sonnet-5'],
};
/** The large tier: only asked to confirm a block. Declines are re-run server-side on another model. */
export const OPUS: ModelConfig = {
  id: 'claude-opus-5',
  tier: 'large',
  ...ANTHROPIC_MODELS['claude-opus-5'],
  effort: 'high',
  serverFallbacks: true,
};

/**
 * Small model for first-pass judgments (with a second model if it is unavailable),
 * and the strongest model only to confirm a block.
 */
export function anthropicTiers(sdk: Anthropic = new Anthropic({ maxRetries: 1 })): ModelTiers {
  return {
    small: [anthropicModel(HAIKU, sdk), anthropicModel(SONNET, sdk)],
    large: [anthropicModel(OPUS, sdk)],
  };
}

/** A ModelClient for one Anthropic model. Rate limits, 5xx and network errors are marked retryable. */
export function anthropicModel(config: ModelConfig, sdk: Anthropic = new Anthropic({ maxRetries: 1 })): ModelClient {
  return {
    config,
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      try {
        const message = await sdk.beta.messages.create(
          {
            model: config.id,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.messages,
            ...(request.tools.length > 0 ? { tools: request.tools } : {}),
            output_config: {
              format: { type: 'json_schema', schema: request.outputSchema },
              ...(config.effort ? { effort: config.effort } : {}),
            },
            ...(config.serverFallbacks
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
              : {}),
          },
          { signal }
        );
        return {
          content: message.content,
          stopReason: message.stop_reason,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          servedBy: message.model,
        };
      } catch (err) {
        throw toModelCallError(err);
      }
    },
  };
}

function toModelCallError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.RateLimitError) return new ModelCallError('rate limited (429)', true, { cause: err });
  if (err instanceof Anthropic.InternalServerError) {
    return new ModelCallError(`server error (${err.status})`, true, { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ModelCallError(`connection failed: ${err.message}`, true, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new ModelCallError(`API error ${err.status ?? ''}: ${err.message}`, false, { cause: err });
  }
  return new ModelCallError(errorMessage(err), false, { cause: err });
}
