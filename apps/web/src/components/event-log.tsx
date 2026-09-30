'use client';

import { type JSX, useEffect, useRef } from 'react';
import type { LogLine } from '../lib/replay.js';
import { TONE_CLASS } from './tone.js';

/** The run as it happens, one line per event, newest at the bottom. Scrolls itself, never the page. */
export function EventLog({
  lines,
  waiting,
}: {
  lines: readonly LogLine[];
  waiting?: { span?: string; model: string } | undefined;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, waiting]);

  return (
    <div
      ref={box}
      className="h-[26rem] overflow-y-auto rounded-lg bg-neutral-50 p-3 font-mono text-[12.5px] leading-6 dark:bg-neutral-950"
      aria-live="polite"
      aria-label="Event log"
    >
      {lines.length === 0 && <p className="text-neutral-500">Press play to start the run.</p>}
      {lines.map(({ seq, span, line }, i) => (
        <div
          key={seq}
          className={`${line.heading ? 'mt-3 font-semibold' : ''} ${i === lines.length - 1 ? 'rounded bg-sky-100/60 dark:bg-sky-900/30' : ''} flex gap-3 px-1`}
        >
          <span className="hidden w-40 shrink-0 truncate text-neutral-400 sm:inline dark:text-neutral-500">
            {line.heading ? '' : (span ?? '')}
          </span>
          <span className={`${TONE_CLASS[line.tone]} break-words`}>
            {line.icon} {line.text}
          </span>
        </div>
      ))}
      {waiting && (
        <div className="flex gap-3 px-1">
          <span className="hidden w-40 shrink-0 truncate text-neutral-400 sm:inline">{waiting.span ?? ''}</span>
          <span className="animate-pulse text-sky-700 dark:text-sky-300">… waiting for {waiting.model}</span>
        </div>
      )}
    </div>
  );
}
