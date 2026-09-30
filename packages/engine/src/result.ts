/** Why an expected failure happened. `unreadable` means we got an answer but could not parse it. */
export type FailureReason = 'timeout' | 'unreadable' | 'failed';

/**
 * The result of something that can fail in normal operation: a remote call, a model answer.
 * Programmer errors still throw. "We could not look" is a failure, never a success.
 */
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: FailureReason; readonly detail: string };

/** Wraps a success. */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Wraps an expected failure. */
export function fail<T = never>(reason: FailureReason, detail: string): Result<T> {
  return { ok: false, reason, detail };
}

/** Turns a promise into a Result, classifying timeouts and parse failures apart from other errors. */
export async function settle<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return ok(await promise);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return fail('timeout', detail);
    if (name === 'ZodError' || err instanceof SyntaxError) return fail('unreadable', detail);
    return fail('failed', detail);
  }
}
