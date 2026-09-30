import type { CheckResult, Severity } from '@pkgwarden/contracts';
import type { JSX } from 'react';

const SEVERITY: Record<Severity, string> = {
  critical: 'bg-rose-600 text-white',
  high: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  low: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  info: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};
const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Flagged checks first, most serious on top; everything that passed folded away underneath. */
export function ChecksPanel({ checks }: { checks: readonly CheckResult[] }): JSX.Element {
  if (checks.length === 0) return <p className="text-sm text-neutral-500">The rules run once the evidence is in.</p>;
  const flagged = checks.filter(c => c.status === 'flagged').sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const rest = checks.filter(c => c.status !== 'flagged');

  return (
    <div className="space-y-3 text-sm">
      {flagged.length === 0 && <p className="text-emerald-700 dark:text-emerald-300">No rule flagged anything.</p>}
      <ul className="space-y-2">
        {flagged.map(c => (
          <li key={c.checkId} className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY[c.severity]}`}>
              {c.severity}
            </span>
            <span>
              <span className="font-mono text-[13px]">{c.checkId}</span>
              <span className="text-neutral-600 dark:text-neutral-400"> · {c.message}</span>
            </span>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            {rest.length} other checks ({rest.filter(c => c.status === 'passed').length} passed)
          </summary>
          <ul className="mt-2 space-y-1">
            {rest.map(c => (
              <li key={c.checkId} className="text-neutral-500">
                <span className="font-mono text-[12px]">{c.checkId}</span> · {c.status} · {c.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
