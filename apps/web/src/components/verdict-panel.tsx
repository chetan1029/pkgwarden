import { type CheckResult, type PackageVerdict, targetLabel } from '@pkgwarden/contracts';
import type { JSX } from 'react';
import { VerdictBadge } from './verdict-badge.js';

/** The final answer: verdict, reasons, what each judge concluded, and where to look. */
export function VerdictPanel({ verdict }: { verdict?: PackageVerdict | undefined }): JSX.Element {
  if (!verdict) {
    return <p className="text-sm text-neutral-500">The verdict appears when the run finishes.</p>;
  }
  const evidence = verdict.checks
    .filter((c: CheckResult) => c.status === 'flagged')
    .flatMap(c => c.evidence.map(e => ({ ...e, checkId: c.checkId })))
    .slice(0, 8);

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={verdict.verdict} large />
        <span className="font-mono text-sm">{targetLabel(verdict)}</span>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {verdict.reasons.map(r => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {verdict.judges.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Judges</h3>
          <ul className="space-y-1 text-sm">
            {verdict.judges.map(j => (
              <li key={j.agentId}>
                <span className="font-mono text-[13px]">{j.agentId}</span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {' '}
                  ({j.status}) {j.summary}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {evidence.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Evidence</h3>
          <ul className="space-y-1 text-sm">
            {evidence.map(e => (
              <li key={`${e.checkId}-${e.label}-${e.file ?? e.url ?? ''}-${e.line ?? ''}`}>
                <span className="text-neutral-600 dark:text-neutral-400">{e.label}</span>{' '}
                {e.file && (
                  <span className="font-mono text-[12px]">
                    {e.file}
                    {e.line ? `:${e.line}` : ''}
                  </span>
                )}
                {e.url && (
                  <a className="text-sky-700 underline dark:text-sky-300" href={e.url} rel="noreferrer" target="_blank">
                    {e.url.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
