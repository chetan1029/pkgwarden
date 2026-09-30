'use client';

import { formatUsd, reduce, type RunEvent } from '@pkgwarden/contracts';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { TraceEntry } from '../lib/catalog.js';
import { delayFor, logLines, waitingOn } from '../lib/replay.js';
import { AgentList, type SkippedAgent } from './agent-list.js';
import { ChecksPanel } from './checks-panel.js';
import { EventLog } from './event-log.js';
import { Panel } from './panel.js';
import { VerdictBadge } from './verdict-badge.js';
import { VerdictPanel } from './verdict-panel.js';

type Which = 'first' | 'second';
const SPEEDS = [1, 2, 4] as const;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True when the visitor asked for less motion. False while the page is rendered at build time. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false
  );
}

/** Replays one recorded run event by event. Everything shown is folded from the same events the CLI prints. */
export function RunViewer({
  entry,
  judges,
  first,
  second,
}: {
  entry: TraceEntry;
  judges: 'offline' | 'live';
  first: readonly RunEvent[];
  second: readonly RunEvent[];
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [which, setWhich] = useState<Which>('first');
  // With reduced motion the whole run is shown at once, until the visitor presses a control.
  const [touched, setTouched] = useState(false);
  const [position, setPosition] = useState(0);
  const [wantsPlay, setWantsPlay] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const events = which === 'first' ? first : second;
  const still = reducedMotion && !touched;
  const shown = still ? events.length : position;
  const finished = shown >= events.length;
  const playing = !still && wantsPlay && !finished;

  useEffect(() => {
    const next = events[shown];
    if (!playing || !next) return;
    const timer = setTimeout(() => setPosition(p => p + 1), delayFor(next) / speed);
    return () => clearTimeout(timer);
  }, [playing, shown, events, speed]);

  const restart = useCallback(() => {
    setTouched(true);
    setPosition(0);
    setWantsPlay(true);
  }, []);
  const step = useCallback(() => {
    setTouched(true);
    setWantsPlay(false);
    setPosition(p => Math.min(p + 1, events.length));
  }, [events.length]);
  const skipToEnd = useCallback(() => {
    setTouched(true);
    setWantsPlay(false);
    setPosition(events.length);
  }, [events.length]);
  const toggle = useCallback(() => {
    if (finished) return restart();
    setTouched(true);
    setWantsPlay(p => !p);
  }, [finished, restart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName))
        return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') step();
      else if (e.key.toLowerCase() === 'r') restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, step, restart]);

  const switchRun = (to: Which) => {
    setWhich(to);
    setPosition(0);
    setWantsPlay(true);
  };

  const view = useMemo(() => reduce(events.slice(0, shown)), [events, shown]);
  const lines = useMemo(() => logLines(events, shown), [events, shown]);
  const waiting = playing ? waitingOn(events, shown) : undefined;
  const skipped: SkippedAgent[] = useMemo(
    () =>
      events
        .slice(0, shown)
        .flatMap(e =>
          e.type === 'agent.skipped' ? [{ parentSpan: e.span, agentId: e.agentId, reason: e.reason }] : []
        ),
    [events, shown]
  );
  const budgetShare = view.budgetUsd > 0 ? Math.min(100, (view.spentUsd / view.budgetUsd) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          ← All scenarios
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold sm:text-2xl">{entry.label}</h1>
          <span className="text-sm text-neutral-500">expected</span>
          <VerdictBadge verdict={entry.expected} />
        </div>
        <p className="max-w-3xl text-neutral-600 dark:text-neutral-400">{entry.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800" role="tablist">
          {(['first', 'second'] as const).map(w => (
            <button
              key={w}
              role="tab"
              aria-selected={which === w}
              onClick={() => switchRun(w)}
              className={`rounded-md px-3 py-1.5 text-sm ${which === w ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}`}
            >
              {w === 'first' ? 'First run' : 'Run again (cached)'}
            </button>
          ))}
        </div>
        <button
          onClick={toggle}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
          aria-keyshortcuts="Space"
        >
          {playing ? 'Pause' : finished ? 'Replay' : 'Play'}
        </button>
        <button
          onClick={step}
          disabled={finished}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-800"
          aria-keyshortcuts="ArrowRight"
        >
          Step
        </button>
        <button
          onClick={skipToEnd}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
        >
          Skip to end
        </button>
        <div className="inline-flex items-center gap-1 text-sm" aria-label="Replay speed">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={`rounded-md px-2 py-1 ${speed === s ? 'bg-neutral-200 font-medium dark:bg-neutral-800' : 'text-neutral-500'}`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm tabular-nums text-neutral-500">
          event {shown} of {events.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800" aria-hidden>
        <div
          className="h-full bg-sky-600 transition-[width] duration-200"
          style={{ width: `${(shown / Math.max(1, events.length)) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Budget used" value={formatUsd(view.spentUsd)} hint={`of ${formatUsd(view.budgetUsd)}`}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-emerald-600" style={{ width: `${budgetShare}%` }} />
          </div>
        </Metric>
        <Metric
          label="Model calls"
          value={String(view.modelCalls)}
          hint={view.reusedCalls ? `${view.reusedCalls} reused from cache` : 'only when a rule asks'}
        />
        <Metric
          label="Tool calls"
          value={String(view.toolCalls)}
          hint={view.cachedToolCalls ? `${view.cachedToolCalls} from cache` : 'every call recorded'}
        />
        <Metric label="Saved by the cache" value={formatUsd(view.savedUsd)} hint="same request, same answer" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Event log"
            aside={<span className="hidden text-xs text-neutral-500 sm:inline">Space play · → step · R restart</span>}
          >
            <EventLog lines={lines} waiting={waiting} />
          </Panel>
          <Panel title="Verdict">
            <VerdictPanel verdict={view.verdicts[0]} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Agents">
            <AgentList agents={view.agents} skipped={skipped} />
          </Panel>
          <Panel title="Checks">
            <ChecksPanel checks={view.checks.map(c => c.result)} />
          </Panel>
        </div>
      </div>

      <Panel title="Replay it in your terminal">
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
          This page reads the same trace file the CLI writes. Download it and replay it, or record your own with
          <code className="mx-1 rounded bg-neutral-100 px-1 font-mono text-[13px] dark:bg-neutral-800">--trace</code>.
          {judges === 'offline' &&
            ' These runs were recorded with the offline stand-in judges, so model timings are near zero and costs are what the real models would charge for the same tokens.'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/traces/${which === 'first' ? entry.files.first : entry.files.second}`}
            download
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            Download trace (JSONL)
          </a>
          <code className="rounded bg-neutral-100 px-2 py-1 font-mono text-[13px] dark:bg-neutral-800">
            pkgwarden replay {which === 'first' ? entry.files.first : entry.files.second}
          </code>
        </div>
      </Panel>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-neutral-500">{hint}</p>
      {children}
    </div>
  );
}
