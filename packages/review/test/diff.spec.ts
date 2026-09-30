import { describe, expect, it } from 'vitest';
import { buildExcerpts, diffPackages } from '../src/index.js';

const entry = (text: string) => ({ size: text.length, sha256: text, text });

describe('package diff', () => {
  it('reports added lines with their line numbers in the new file', () => {
    const diff = diffPackages({ 'a.js': entry('one\ntwo\n') }, { 'a.js': entry('one\nnew\ntwo\n') });
    expect(diff.changes[0]?.addedLines).toEqual([{ line: 2, text: 'new' }]);
  });

  it('treats every file of a new package as added', () => {
    const diff = diffPackages(undefined, { 'a.js': entry('x') });
    expect(diff.added).toEqual(['a.js']);
  });

  it('marks an excerpt that was cut, so the judge knows the file goes on', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const [excerpt] = buildExcerpts(diffPackages(undefined, { 'a.js': entry(long) }), () => 0, 1_000);
    expect(excerpt?.truncated).toBe(true);
  });
});
