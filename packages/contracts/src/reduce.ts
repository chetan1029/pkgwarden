import type { AgentStatus, RunEvent } from './events.js';
import type { CheckResult, PackageVerdict } from './verdict.js';

/** One agent invocation as the viewers show it. */
export interface AgentView {
  span: string;
  parentSpan?: string | undefined;
  agentId: string;
  kind: 'code' | 'model';
  label?: string | undefined;
  status: 'running' | AgentStatus;
  costUsd: number;
  modelCalls: number;
  reusedCalls: number;
  toolCalls: number;
}

/** Everything a viewer needs about a run, folded from its events. */
export interface RunView {
  runId?: string;
  label?: string;
  status: 'idle' | 'running' | 'done' | 'failed';
  modelsEnabled: boolean;
  startedAt?: string;
  finishedAt?: string;
  budgetUsd: number;
  spentUsd: number;
  savedUsd: number;
  modelCalls: number;
  reusedCalls: number;
  toolCalls: number;
  cachedToolCalls: number;
  refusals: number;
  fallbacks: number;
  limitsReached: number;
  agents: AgentView[];
  checks: { target: string; result: CheckResult }[];
  verdicts: PackageVerdict[];
  error?: string;
}

/** The view before any event arrives. */
export function emptyRunView(): RunView {
  return {
    status: 'idle',
    modelsEnabled: false,
    budgetUsd: 0,
    spentUsd: 0,
    savedUsd: 0,
    modelCalls: 0,
    reusedCalls: 0,
    toolCalls: 0,
    cachedToolCalls: 0,
    refusals: 0,
    fallbacks: 0,
    limitsReached: 0,
    agents: [],
    checks: [],
    verdicts: [],
  };
}

/**
 * Folds one event into the view. The CLI, the web replay and the live viewer all use this,
 * so they can never disagree about what a run did. It returns a new object each time.
 */
export function applyEvent(view: RunView, event: RunEvent): RunView {
  const next: RunView = { ...view, agents: view.agents, checks: view.checks, verdicts: view.verdicts };
  const agent = event.span ? view.agents.find(a => a.span === event.span) : undefined;
  const updateAgent = (patch: Partial<AgentView>) => {
    if (!agent) return;
    next.agents = view.agents.map(a => (a === agent ? { ...a, ...patch } : a));
  };

  switch (event.type) {
    case 'run.started':
      return {
        ...emptyRunView(),
        runId: event.runId,
        label: event.label,
        status: 'running',
        modelsEnabled: event.modelsEnabled,
        startedAt: event.ts,
        budgetUsd: event.budgetUsd,
      };
    case 'run.finished':
      next.status = event.status;
      next.finishedAt = event.ts;
      next.spentUsd = event.costUsd;
      next.savedUsd = event.savedUsd;
      if (event.error) next.error = event.error;
      return next;
    case 'agent.started':
      if (!event.span) return next;
      next.agents = [
        ...view.agents,
        {
          span: event.span,
          parentSpan: event.parentSpan,
          agentId: event.agentId,
          kind: event.kind,
          label: event.label,
          status: 'running',
          costUsd: 0,
          modelCalls: 0,
          reusedCalls: 0,
          toolCalls: 0,
        },
      ];
      return next;
    case 'agent.finished':
      updateAgent({ status: event.status, costUsd: event.costUsd });
      return next;
    case 'tool.result':
      next.toolCalls = view.toolCalls + 1;
      if (event.cached) next.cachedToolCalls = view.cachedToolCalls + 1;
      updateAgent({ toolCalls: (agent?.toolCalls ?? 0) + 1 });
      return next;
    case 'limit.reached':
      next.limitsReached = view.limitsReached + 1;
      return next;
    case 'tool.refused':
    case 'agent.refused':
      next.refusals = view.refusals + 1;
      return next;
    case 'model.completed':
      next.modelCalls = view.modelCalls + 1;
      next.spentUsd = view.spentUsd + event.costUsd;
      updateAgent({
        modelCalls: (agent?.modelCalls ?? 0) + 1,
        costUsd: (agent?.costUsd ?? 0) + event.costUsd,
      });
      return next;
    case 'model.reused':
      next.reusedCalls = view.reusedCalls + 1;
      next.savedUsd = view.savedUsd + event.savedUsd;
      updateAgent({ reusedCalls: (agent?.reusedCalls ?? 0) + 1 });
      return next;
    case 'model.fallback':
      next.fallbacks = view.fallbacks + 1;
      return next;
    case 'check.result':
      next.checks = [...view.checks, { target: event.target, result: event.result }];
      return next;
    case 'verdict':
      next.verdicts = [...view.verdicts, event.result];
      return next;
    default:
      return next;
  }
}

/** Folds a whole trace into a view. */
export function reduce(events: readonly RunEvent[]): RunView {
  return events.reduce(applyEvent, emptyRunView());
}
