import type { LineTone } from '@pkgwarden/contracts';

/** Text colour for each tone of an event line. */
export const TONE_CLASS: Record<LineTone, string> = {
  plain: 'text-neutral-800 dark:text-neutral-200',
  muted: 'text-neutral-500 dark:text-neutral-400',
  info: 'text-sky-700 dark:text-sky-300',
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
  limit: 'text-violet-700 dark:text-violet-300',
};
