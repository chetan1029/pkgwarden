import { RunEvent } from './events.js';

/** A trace line that is broken somewhere other than at the end of the file. */
export class TraceReadError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'TraceReadError';
    this.line = line;
  }
}

/**
 * Parses a JSONL trace. A half-written last line (a process killed mid-write) is dropped;
 * a broken line anywhere else is refused with its line number, because it means the file was edited or corrupted.
 */
export function parseTrace(text: string): { events: RunEvent[]; droppedLastLine: boolean } {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const events: RunEvent[] = [];
  let droppedLastLine = false;
  lines.forEach((line, i) => {
    const isLast = i === lines.length - 1;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      if (isLast) {
        droppedLastLine = true;
        return;
      }
      throw new TraceReadError(`line ${i + 1} is not valid JSON`, i + 1);
    }
    const parsed = RunEvent.safeParse(json);
    if (!parsed.success) {
      throw new TraceReadError(`line ${i + 1} is not a pkgwarden event: ${parsed.error.issues[0]?.message}`, i + 1);
    }
    events.push(parsed.data);
  });
  return { events, droppedLastLine };
}
