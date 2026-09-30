import { Verdict } from '@pkgwarden/contracts';
import { z } from 'zod';

/** One recorded scenario: what it tests, what it should get, and where its two traces are. */
export const TraceEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string(),
    label: z.string(),
    expected: Verdict,
    verdict: Verdict,
    costUsd: z.number(),
    modelCalls: z.number().int(),
    /** Trace file names under /traces: the first run, and the same run again on a warm cache. */
    files: z.object({ first: z.string(), second: z.string() }).strict(),
  })
  .strict();
/** One recorded scenario. */
export type TraceEntry = z.infer<typeof TraceEntry>;

/** `public/traces/index.json`, written by scripts/record-traces.ts. */
export const TraceIndex = z
  .object({
    contractVersion: z.string(),
    /** `offline` traces use the scripted stand-in judges; `live` ones used real models. */
    judges: z.enum(['offline', 'live']),
    scenarios: z.array(TraceEntry),
  })
  .strict();
/** `public/traces/index.json`. */
export type TraceIndex = z.infer<typeof TraceIndex>;
