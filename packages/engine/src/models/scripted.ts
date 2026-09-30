import type Anthropic from '@anthropic-ai/sdk';
import { ModelCallError } from '../runtime/errors.js';
import type { ModelClient, ModelConfig, ModelRequest, ModelResponse } from './types.js';

/** One answer from a scripted model: tool calls, a final JSON answer, or raw text. */
export interface ScriptedTurn {
  toolCalls?: { name: string; input: unknown }[];
  /** Final answer, serialised to JSON as the model's text. */
  output?: unknown;
  /** Raw text, for testing invalid answers. */
  text?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Decides a scripted model's answer from the request and the turn number. */
export type Script = (request: ModelRequest, turn: number) => ScriptedTurn | Promise<ScriptedTurn>;

/**
 * A stand-in model for tests, offline evals and the demo. It is stateless (the turn number comes
 * from the request), so the same request always gets the same answer, like a real cache hit.
 */
export function scriptedModel(config: ModelConfig, script: Script): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    config,
    requests,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const turn = request.messages.filter(m => m.role === 'assistant').length;
      const step = await script(request, turn);
      const content: unknown[] = [];
      if (step.text !== undefined || step.output !== undefined) {
        content.push({ type: 'text', text: step.text ?? JSON.stringify(step.output), citations: null });
      }
      step.toolCalls?.forEach((call, i) => {
        content.push({ type: 'tool_use', id: `toolu_${turn}_${i}`, name: call.name, input: call.input });
      });
      return {
        content: content as Anthropic.Beta.BetaContentBlock[],
        stopReason: step.stopReason ?? (step.toolCalls?.length ? 'tool_use' : 'end_turn'),
        inputTokens: step.inputTokens ?? 1200,
        outputTokens: step.outputTokens ?? 300,
        servedBy: config.id,
      };
    },
  };
}

/** A model that is always down, for testing fallbacks. */
export function failingModel(config: ModelConfig, message = 'server error (503)'): ModelClient {
  return {
    config,
    async complete(): Promise<ModelResponse> {
      throw new ModelCallError(message, true);
    },
  };
}
