import type { JSX } from 'react';
import Link from 'next/link';
import { VerdictBadge } from '../components/verdict-badge.js';
import { loadIndex } from '../lib/traces.js';

const STEPS = [
  {
    title: 'Evidence',
    text: 'The npm registry, OSV.dev, deps.dev and both versions’ tarballs. Tarballs are read in memory and never installed or run.',
  },
  {
    title: 'Rules first',
    text: 'Fifteen plain-code checks. A model reads the code only when a rule flags something it cannot settle, and the strongest model only confirms a block.',
  },
  {
    title: 'A verdict you can read',
    text: 'allow, review, block or undecided, decided by plain code with every reason listed. Undecided never counts as allow.',
  },
];

const ENGINE = [
  'Agents declare their tools, sub-agents, steps, time and budget. The engine checks every definition before a run and runs every tool call itself.',
  'Budgets nest: run, package, agent. A model call reserves the worst case first, so a run cannot overspend.',
  'Model answers are cached under a hash of the exact request. The same input never costs twice.',
  'Every step is a typed event. This page, the CLI and the tests all fold the same events.',
];

/** The landing page: what pkgwarden does, and every recorded scenario. */
export default async function Home(): Promise<JSX.Element> {
  const index = await loadIndex();
  const correct = index.scenarios.filter(s => s.verdict === s.expected).length;
  const featured = index.scenarios.find(s => s.id === 'prompt-injection') ?? index.scenarios[0];

  return (
    <div className="space-y-16">
      <section className="max-w-3xl space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Agents that review npm dependency changes before they reach main.
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          When a pull request adds or upgrades a package, pkgwarden collects the evidence, runs its rules, and calls a
          model only when a rule asks. Every step is recorded, so any run can be replayed exactly. Here are nine of
          them.
        </p>
        <div className="flex flex-wrap gap-3">
          {featured && (
            <Link
              href={`/runs/${featured.id}/`}
              className="rounded-lg bg-sky-600 px-5 py-2.5 font-medium text-white hover:bg-sky-700"
            >
              Watch a run
            </Link>
          )}
          <Link
            href="#scenarios"
            className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            See all scenarios
          </Link>
        </div>
        <p className="text-sm text-neutral-500">
          {correct} of {index.scenarios.length} scenarios get the expected verdict · a repeated run costs $0.000
        </p>
      </section>

      <section id="scenarios" className="scroll-mt-20 space-y-4">
        <h2 className="text-xl font-semibold">Scenarios</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {index.scenarios.map(s => (
            <Link
              key={s.id}
              href={`/runs/${s.id}/`}
              className="group flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-sky-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-sky-600"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm font-semibold">{s.label}</span>
                  <VerdictBadge verdict={s.verdict} />
                </div>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">{s.description}</p>
              </div>
              <p className="mt-4 text-xs text-neutral-500">
                {s.modelCalls === 0 ? 'no model calls' : `${s.modelCalls} model call${s.modelCalls === 1 ? '' : 's'}`} ·
                ${s.costUsd.toFixed(4)}{' '}
                <span className="text-sky-700 group-hover:underline dark:text-sky-300">· replay →</span>
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 space-y-6">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="font-semibold">The engine underneath</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
            {ENGINE.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
