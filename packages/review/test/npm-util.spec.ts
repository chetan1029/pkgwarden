import { describe, expect, it } from 'vitest';
import { editDistance, githubRepo, parseSpec, previousVersion, registryPath } from '../src/index.js';

describe('npm helpers', () => {
  it('parses scoped specs', () => {
    expect(parseSpec('@scope/pkg@1.2.3')).toEqual({ name: '@scope/pkg', version: '1.2.3' });
    expect(parseSpec('left-pad')).toEqual({ name: 'left-pad' });
  });

  it('encodes the slash of a scoped name for the registry', () => {
    expect(registryPath('@scope/pkg')).toBe('@scope%2Fpkg');
  });

  it('finds the version published before, ignoring prereleases', () => {
    const times = { '1.0.0': '2024-01-01', '1.1.0-beta.1': '2024-02-01', '1.1.0': '2024-03-01', created: '2023-12-01' };
    expect(previousVersion(times, '1.1.0')).toBe('1.0.0');
  });

  it('reads GitHub repository links in their usual shapes', () => {
    expect(githubRepo('git+https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(githubRepo({ url: 'git@github.com:a/b.git' })).toEqual({ owner: 'a', repo: 'b' });
    expect(githubRepo('github:a/b')).toEqual({ owner: 'a', repo: 'b' });
    expect(githubRepo('https://gitlab.com/a/b')).toBeUndefined();
  });

  it('counts a swapped pair of letters as one edit', () => {
    expect(editDistance('lodahs', 'lodash')).toBe(1);
    expect(editDistance('reakt', 'react')).toBe(1);
  });
});
