import { type AgentView, formatUsd } from '@pkgwarden/contracts';
import type { JSX } from 'react';

const STATUS: Record<AgentView['status'], string> = {
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200 animate-pulse',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  skipped: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  out_of_budget: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  timeout: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  refused: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
};

/** A judge that no rule asked for, shown under the agent that decided not to call it. */
export interface SkippedAgent {
  readonly parentSpan?: string | undefined;
  readonly agentId: string;
  readonly reason: string;
}

/** Every agent invocation as a tree, with its status, cost and calls. */
export function AgentList({
  agents,
  skipped,
}: {
  agents: readonly AgentView[];
  skipped: readonly SkippedAgent[];
}): JSX.Element {
  if (agents.length === 0) return <p className="text-sm text-neutral-500">No agent has started yet.</p>;
  const children = (parent: string | undefined) => agents.filter(a => a.parentSpan === parent);

  const render = (agent: AgentView, depth: number): JSX.Element => (
    <li key={agent.span}>
      <div className="flex items-center justify-between gap-2 py-1.5" style={{ paddingLeft: `${depth * 14}px` }}>
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px]">{agent.agentId}</p>
          <p className="text-xs text-neutral-500">
            {agent.kind === 'model' ? 'model' : 'code'} · {agent.toolCalls} tools
            {agent.modelCalls + agent.reusedCalls > 0 &&
              ` · ${agent.modelCalls} model${agent.reusedCalls ? `, ${agent.reusedCalls} reused` : ''}`}
            {agent.costUsd > 0 && ` · ${formatUsd(agent.costUsd)}`}
          </p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[agent.status]}`}>
          {agent.status.replace('_', ' ')}
        </span>
      </div>
      <ul>
        {children(agent.span).map(child => render(child, depth + 1))}
        {skipped
          .filter(s => s.parentSpan === agent.span)
          .map(s => (
            <li
              key={`${s.parentSpan}-${s.agentId}`}
              className="py-1.5 text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 14}px` }}
            >
              <p className="font-mono text-[13px] line-through decoration-neutral-400/60">{s.agentId}</p>
              <p className="text-xs">skipped: {s.reason}</p>
            </li>
          ))}
      </ul>
    </li>
  );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {children(undefined).map(a => render(a, 0))}
    </ul>
  );
}
