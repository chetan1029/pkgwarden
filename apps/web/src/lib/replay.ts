import { describeEvent, type EventLine, type RunEvent } from '@pkgwarden/contracts';

/**
 * How long to wait before showing an event, in milliseconds at 1× speed. Recorded durations are
 * a few milliseconds in the demo, far too fast to follow, so replay is paced for reading instead.
 * Each line still shows the duration that was recorded.
 */
export function delayFor(event: RunEvent): number {
  switch (event.type) {
    case 'run.started':
      return 300;
    case 'agent.started':
      return event.agentId === 'review-package' ? 500 : 350;
    case 'tool.called':
      return 0;
    case 'tool.result':
      return 200;
    case 'check.result':
      return event.result.status === 'flagged' ? 500 : 40;
    case 'model.requested':
      return 450;
    case 'model.completed':
      return 1100;
    case 'model.reused':
      return 500;
    case 'verdict':
      return 700;
    default:
      return 180;
  }
}

/** One line of the event log. */
export interface LogLine {
  readonly seq: number;
  readonly span?: string | undefined;
  readonly line: EventLine;
}

/** The log lines for the first `shown` events. Bookkeeping events have no line and are left out. */
export function logLines(events: readonly RunEvent[], shown: number): LogLine[] {
  const out: LogLine[] = [];
  for (const event of events.slice(0, shown)) {
    const line = describeEvent(event);
    if (line) out.push({ seq: event.seq, span: event.span, line });
  }
  return out;
}

/** The model an agent is waiting on right now, when the last event shown is a request with no answer yet. */
export function waitingOn(events: readonly RunEvent[], shown: number): { span?: string; model: string } | undefined {
  const last = events[shown - 1];
  if (last?.type !== 'model.requested') return undefined;
  return { ...(last.span ? { span: last.span } : {}), model: last.model };
}
