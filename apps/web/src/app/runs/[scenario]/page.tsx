import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { RunViewer } from '../../../components/run-viewer.js';
import { loadIndex, loadRuns } from '../../../lib/traces.js';

type Props = { params: Promise<{ scenario: string }> };

// Only recorded scenarios exist; anything else is a 404 at build time, not a runtime lookup.
export const dynamicParams = false;

/** One page per recorded scenario. */
export async function generateStaticParams(): Promise<{ scenario: string }[]> {
  const index = await loadIndex();
  return index.scenarios.map(s => ({ scenario: s.id }));
}

/** Page title and description from the scenario. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { scenario } = await params;
  const entry = (await loadIndex()).scenarios.find(s => s.id === scenario);
  return entry ? { title: entry.label, description: entry.description } : {};
}

/** Loads both traces of a scenario at build time and hands them to the replay viewer. */
export default async function RunPage({ params }: Props): Promise<JSX.Element> {
  const { scenario } = await params;
  const index = await loadIndex();
  const entry = index.scenarios.find(s => s.id === scenario);
  if (!entry) notFound();
  const runs = await loadRuns(entry);
  return <RunViewer entry={entry} judges={index.judges} first={runs.first} second={runs.second} />;
}
