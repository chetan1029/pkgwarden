import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTrace, type RunEvent } from '@pkgwarden/contracts';
import { type TraceEntry, TraceIndex } from './catalog.js';

// Read at build time only: the site is static, so these run once per page while exporting.
const TRACES = join(process.cwd(), 'public', 'traces');

/** The scenario index. Refuses a file that does not match the schema, so a stale recording fails the build. */
export async function loadIndex(): Promise<TraceIndex> {
  const raw: unknown = JSON.parse(await readFile(join(TRACES, 'index.json'), 'utf8'));
  const parsed = TraceIndex.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`public/traces/index.json does not match the schema: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/** Both traces of one scenario, checked against the event contract. */
export async function loadRuns(entry: TraceEntry): Promise<{ first: RunEvent[]; second: RunEvent[] }> {
  const read = async (file: string) => parseTrace(await readFile(join(TRACES, file), 'utf8')).events;
  const [first, second] = await Promise.all([read(entry.files.first), read(entry.files.second)]);
  return { first, second };
}
