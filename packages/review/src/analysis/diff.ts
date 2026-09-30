import { diffLines } from 'diff';
import type { FileEntry } from '../sources/outputs.js';

/** A package's files by path, as `npm.tarball` returns them. */
export type PackageFiles = Readonly<Record<string, FileEntry>>;

/** A line that is new in the later version, with its line number there. */
export interface AddedLine {
  line: number;
  text: string;
}

/** One added or changed file and the lines it added. */
export interface FileChange {
  file: string;
  kind: 'added' | 'changed';
  addedLines: AddedLine[];
  /** True when the file is not text, so there are no lines to show. */
  binary: boolean;
}

/** Everything that differs between two versions of a package. */
export interface PackageDiff {
  added: string[];
  removed: string[];
  changed: string[];
  changes: FileChange[];
}

const MAX_LINES_PER_FILE = 2_000;

/** What's new in `to` compared to `from`. Without `from`, every file counts as added. */
export function diffPackages(from: PackageFiles | undefined, to: PackageFiles): PackageDiff {
  const before = from ?? {};
  const added = Object.keys(to)
    .filter(f => !(f in before))
    .sort();
  const removed = Object.keys(before)
    .filter(f => !(f in to))
    .sort();
  const changed = Object.keys(to)
    .filter(f => f in before && before[f]?.sha256 !== to[f]?.sha256)
    .sort();

  const changes: FileChange[] = [];
  for (const file of added) {
    const entry = to[file] as FileEntry;
    const lines = entry.text === undefined ? [] : entry.text.split('\n');
    changes.push({
      file,
      kind: 'added',
      binary: entry.text === undefined,
      addedLines: lines.slice(0, MAX_LINES_PER_FILE).map((text, i) => ({ line: i + 1, text })),
    });
  }
  for (const file of changed) {
    const oldText = before[file]?.text;
    const newText = to[file]?.text;
    if (oldText === undefined || newText === undefined) {
      changes.push({ file, kind: 'changed', binary: true, addedLines: [] });
      continue;
    }
    const addedLines: AddedLine[] = [];
    let line = 1;
    for (const part of diffLines(oldText, newText)) {
      const partLines = part.value.split('\n');
      if (partLines.at(-1) === '') partLines.pop();
      if (part.removed) continue;
      if (part.added) {
        for (const text of partLines) {
          if (addedLines.length < MAX_LINES_PER_FILE) addedLines.push({ line, text });
          line++;
        }
      } else {
        line += partLines.length;
      }
    }
    changes.push({ file, kind: 'changed', binary: false, addedLines });
  }
  return { added, removed, changed, changes };
}

/** Lines shown to the diff judge from one file. `truncated` says the excerpt was cut. */
export interface Excerpt {
  file: string;
  startLine: number;
  text: string;
  truncated: boolean;
}

/**
 * Picks the lines a judge should read, most suspicious files first, within a character budget.
 * Every cut is marked, so the judge never mistakes the end of an excerpt for the end of a file.
 */
export function buildExcerpts(diff: PackageDiff, priority: (file: string) => number, maxChars: number): Excerpt[] {
  const ordered = [...diff.changes]
    .filter(c => !c.binary && c.addedLines.length > 0)
    .sort((a, b) => priority(b.file) - priority(a.file) || a.file.localeCompare(b.file));
  const out: Excerpt[] = [];
  let used = 0;
  for (const change of ordered) {
    if (used >= maxChars) break;
    const room = Math.min(maxChars - used, 6_000);
    const lines: string[] = [];
    let size = 0;
    let truncated = false;
    for (const { line, text } of change.addedLines) {
      const clipped = text.length > 400 ? `${text.slice(0, 400)} [line cut at 400 chars]` : text;
      const row = `${line}: ${clipped}`;
      if (size + row.length + 1 > room) {
        truncated = true;
        break;
      }
      lines.push(row);
      size += row.length + 1;
    }
    if (lines.length === 0) continue;
    out.push({
      file: change.file,
      startLine: change.addedLines[0]?.line ?? 1,
      text: lines.join('\n'),
      truncated,
    });
    used += size;
  }
  return out;
}
