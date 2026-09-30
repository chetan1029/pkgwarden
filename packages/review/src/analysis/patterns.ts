import type { FileChange } from './diff.js';

/** One suspicious pattern found in newly added code. */
export interface PatternHit {
  pattern: string;
  label: string;
  file: string;
  line: number;
  /** Code that npm runs during install. Hits there matter most. */
  installTime: boolean;
}

const PATTERNS: { id: string; label: string; test: RegExp }[] = [
  {
    id: 'child-process',
    label: 'starts other processes',
    test: /child_process|\bexecSync\s*\(|\bspawn(Sync)?\s*\(/,
  },
  { id: 'eval', label: 'evaluates strings as code', test: /\beval\s*\(|new\s+Function\s*\(/ },
  { id: 'base64-blob', label: 'contains a long base64 blob', test: /[A-Za-z0-9+/]{160,}={0,2}/ },
  {
    id: 'base64-decode',
    label: 'decodes base64 at runtime',
    test: /Buffer\.from\([^)]*['"]base64['"]|\batob\s*\(/,
  },
  {
    id: 'network',
    label: 'makes network requests',
    test: /\bfetch\s*\(|https?\.(get|request)\s*\(|\bnet\.connect|XMLHttpRequest|dns\.lookup/,
  },
  { id: 'env-access', label: 'reads environment variables', test: /process\.env\b/ },
  {
    id: 'credential-paths',
    label: 'touches credential files',
    test: /\.npmrc|\.ssh\/|id_rsa|\.aws\/credentials|\.git-credentials/,
  },
  {
    id: 'obfuscation',
    label: 'looks obfuscated',
    test: /_0x[0-9a-f]{4,}|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){20,}/i,
  },
];

const CODE_FILE = /\.(c|m)?js$|\.ts$|\.sh$|\.py$/;

/** Files an install script runs, for example `node scripts/setup.js` gives `scripts/setup.js`. */
export function installTimeFiles(scripts: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    const script = scripts[hook];
    if (!script) continue;
    for (const m of script.matchAll(/(?:node|sh|bash)\s+(?:\.\/)?([\w./-]+)/g)) if (m[1]) out.add(m[1]);
  }
  return out;
}

/** Finds each suspicious pattern once per file, at its first added line. */
export function scanChanges(changes: FileChange[], installFiles: Set<string>): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const change of changes) {
    if (!CODE_FILE.test(change.file) && !installFiles.has(change.file)) continue;
    const installTime = installFiles.has(change.file);
    const seen = new Set<string>();
    for (const { line, text } of change.addedLines) {
      for (const p of PATTERNS) {
        // Report each pattern once per file, at its first line: the judge reads the rest.
        if (seen.has(p.id) || !p.test.test(text)) continue;
        seen.add(p.id);
        hits.push({ pattern: p.id, label: p.label, file: change.file, line, installTime });
      }
    }
  }
  return hits;
}

/** A newly added file whose lines are very long reads like minified or generated code. */
export function looksMinified(change: FileChange): boolean {
  if (change.kind !== 'added' || !CODE_FILE.test(change.file) || change.addedLines.length === 0) return false;
  const chars = change.addedLines.reduce((n, l) => n + l.text.length, 0);
  return chars > 2_000 && chars / change.addedLines.length > 400;
}
