/** A signal that aborts after `ms`, plus a way to stop the timer once the work is done. */
export interface Deadline {
  readonly signal: AbortSignal;
  /** True once the time is up, as opposed to the parent signal aborting. */
  readonly expired: () => boolean;
  readonly clear: () => void;
}

/**
 * Built on setTimeout and AbortController rather than AbortSignal.timeout, so tests can
 * fake time and a finished agent never leaves a timer running.
 */
export function deadline(ms: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException(`timed out after ${ms} ms`, 'TimeoutError'));
  }, ms);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  return {
    signal: controller.signal,
    expired: () => expired,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}
