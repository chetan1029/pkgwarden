import type { AnyTool } from '@pkgwarden/engine';
import { describe, expect, it } from 'vitest';
import { FixtureHttp, reviewTools } from '../src/index.js';

const signal = new AbortController().signal;
const tool = (tools: AnyTool[], id: string) => tools.find(t => t.id === id) as AnyTool;

describe('data sources', () => {
  it('reports a package that is not on the registry as not found', async () => {
    const out = await tool(reviewTools(new FixtureHttp()), 'npm.packument').run({ name: 'nope' }, { signal });
    expect(out).toMatchObject({ found: false });
  });

  it('fails a GitHub list it could not read instead of returning an empty list', async () => {
    const http = new FixtureHttp().on('GET', 'https://api.github.com/repos/a/b/commits?per_page=10', () => ({
      status: 500,
      body: {},
    }));
    await expect(
      tool(reviewTools(http), 'github.recentCommits').run({ owner: 'a', repo: 'b' }, { signal })
    ).rejects.toThrow('GitHub answered 500');
  });

  it('refuses a tarball whose bytes do not match the registry integrity hash', async () => {
    const http = new FixtureHttp().on('GET', 'https://registry.npmjs.org/p/-/p-1.0.0.tgz', () => ({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
    }));
    const run = tool(reviewTools(http), 'npm.tarball').run(
      { url: 'https://registry.npmjs.org/p/-/p-1.0.0.tgz', integrity: 'sha512-AAAA' },
      { signal }
    );
    await expect(run).rejects.toThrow('integrity mismatch');
  });
});
