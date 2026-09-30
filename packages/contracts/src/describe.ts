import type { RunEvent } from './events.js';

/** How a line should look: the terminal and the web page each map these to their own colours. */
export type LineTone = 'plain' | 'muted' | 'info' | 'ok' | 'warn' | 'danger' | 'limit';

/** One event as a person reads it. `heading` starts a new package section. */
export interface EventLine {
  readonly tone: LineTone;
  readonly icon: string;
  readonly text: string;
  readonly heading?: boolean;
}

/** Dollars with four decimals below a cent, three above. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 3)}`;
}

/** Milliseconds under a second, seconds above. */
export function formatMs(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

const ROOTS = new Set(['review-package', 'review-packages']);

/**
 * The words for one event, shared by the CLI and the web viewer so they never describe a run
 * differently. Returns undefined for events that are only bookkeeping (a check that passed, a tool call before its result).
 */
export function describeEvent(event: RunEvent): EventLine | undefined {
  switch (event.type) {
    case 'run.started':
      return {
        tone: 'info',
        icon: '●',
        text: `${event.label} · budget ${formatUsd(event.budgetUsd)} · models ${event.modelsEnabled ? 'on' : 'off (rules only)'}`,
      };
    case 'run.finished':
      return {
        tone: event.status === 'done' ? 'info' : 'danger',
        icon: '●',
        text: `run ${event.status} · spent ${formatUsd(event.costUsd)} · saved ${formatUsd(event.savedUsd)}`,
      };
    case 'agent.started':
      return event.agentId === 'review-package'
        ? { tone: 'info', icon: '▸', text: event.label ?? event.agentId, heading: true }
        : { tone: 'info', icon: '◆', text: 'started' };
    case 'agent.finished': {
      if (ROOTS.has(event.agentId)) return undefined;
      const cost = event.costUsd > 0 ? `, ${formatUsd(event.costUsd)}` : '';
      const error = event.error ? ` (${event.error})` : '';
      return {
        tone: event.status === 'done' ? 'ok' : 'warn',
        icon: '◆',
        text: `${event.status} in ${formatMs(event.durationMs)}${cost}${error}`,
      };
    }
    case 'agent.skipped':
      return { tone: 'muted', icon: '–', text: `${event.agentId} skipped: ${event.reason}` };
    case 'tool.result':
      return {
        tone: 'muted',
        icon: '·',
        text: `${event.tool} ${event.cached ? '(cached)' : formatMs(event.durationMs)}`,
      };
    case 'tool.failed':
      return { tone: 'warn', icon: '!', text: `${event.tool} failed: ${event.error}` };
    case 'tool.refused':
    case 'agent.refused':
      return { tone: 'danger', icon: '✗', text: `refused: ${event.reason}` };
    case 'check.result': {
      const { status, severity, checkId, message } = event.result;
      if (status !== 'flagged') return undefined;
      return {
        tone: severity === 'critical' || severity === 'high' ? 'danger' : 'warn',
        icon: '⚑',
        text: `[${severity}] ${checkId}: ${message}`,
      };
    }
    case 'model.requested':
      return { tone: 'muted', icon: '→', text: `${event.model} (reserved ${formatUsd(event.reservedUsd)})` };
    case 'model.completed':
      return {
        tone: 'muted',
        icon: '←',
        text: `${event.servedBy} in ${formatMs(event.durationMs)}, ${event.inputTokens} in / ${event.outputTokens} out, ${formatUsd(event.costUsd)}`,
      };
    case 'model.reused':
      return {
        tone: 'ok',
        icon: '↺',
        text: `reused a judgment from ${event.storedAt.slice(0, 16).replace('T', ' ')}, saved ${formatUsd(event.savedUsd)}`,
      };
    case 'model.fallback':
      return { tone: 'warn', icon: '↻', text: `${event.from} failed (${event.reason}), trying ${event.to}` };
    case 'model.failed':
      return { tone: 'warn', icon: '!', text: `${event.model} failed: ${event.error}` };
    case 'model.invalid_output':
      return { tone: 'warn', icon: '!', text: `answer did not match the schema: ${event.issues.split('\n')[0]}` };
    case 'limit.reached':
      return { tone: 'limit', icon: '⏱', text: `${event.limit} limit reached: ${event.detail}` };
    case 'budget.exceeded':
      return {
        tone: 'limit',
        icon: '$',
        text: `over budget "${event.scope}": needed ${formatUsd(event.neededUsd)}, ${formatUsd(event.remainingUsd)} left`,
      };
    case 'verdict':
      return {
        tone: event.result.verdict === 'allow' ? 'ok' : event.result.verdict === 'block' ? 'danger' : 'warn',
        icon: '■',
        text: `verdict: ${event.result.verdict}`,
      };
    case 'note':
      return { tone: 'muted', icon: '·', text: event.message };
    default:
      return undefined;
  }
}
