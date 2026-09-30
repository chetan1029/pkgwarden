import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunEvent } from '@pkgwarden/contracts';

/** Receives every event of a run as it is emitted. `close` waits for anything still being written. */
export interface EventSink {
  write(event: RunEvent): void;
  close?(): Promise<void>;
}

/** Keeps every event in an array. */
export class MemorySink implements EventSink {
  readonly events: RunEvent[] = [];
  write(event: RunEvent): void {
    this.events.push(event);
  }
}

/**
 * Appends one JSON line per event. Appends are chained on one promise, so lines never
 * interleave, and the file is only ever appended to, never rewritten.
 */
export class JsonlFileSink implements EventSink {
  readonly #path: string;
  #queue: Promise<void>;

  constructor(path: string) {
    this.#path = path;
    this.#queue = mkdir(dirname(path), { recursive: true }).then(() => undefined);
  }

  write(event: RunEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    this.#queue = this.#queue.then(() => appendFile(this.#path, line));
  }

  close(): Promise<void> {
    return this.#queue;
  }
}

/** A sink that calls `fn` for every event. */
export function callbackSink(fn: (event: RunEvent) => void): EventSink {
  return { write: fn };
}
