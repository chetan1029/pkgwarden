import type { Verdict } from '@pkgwarden/contracts';
import type { JSX } from 'react';

const STYLES: Record<Verdict, string> = {
  allow:
    'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/30',
  review: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30',
  undecided:
    'bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/30',
  block: 'bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-400/30',
};

/** A verdict as a coloured label. */
export function VerdictBadge({ verdict, large = false }: { verdict: Verdict; large?: boolean }): JSX.Element {
  const size = large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded-md font-semibold uppercase tracking-wide ring-1 ring-inset ${size} ${STYLES[verdict]}`}
    >
      {verdict}
    </span>
  );
}
