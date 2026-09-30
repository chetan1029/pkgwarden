import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveHttp } from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(body = '{}') {
  const fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const authHeader = (fetch: ReturnType<typeof stubFetch>) =>
  new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization');

describe('live http', () => {
  it('sends the GitHub token to api.github.com, read from the named variable at call time', async () => {
    const fetch = stubFetch();
    const http = liveHttp({ githubTokenVariable: 'TEST_GITHUB_TOKEN' });
    vi.stubEnv('TEST_GITHUB_TOKEN', 'secret-1');
    await http.json('https://api.github.com/repos/a/b');
    expect(authHeader(fetch)).toBe('Bearer secret-1');
  });

  it('never sends the token anywhere else', async () => {
    const fetch = stubFetch();
    vi.stubEnv('TEST_GITHUB_TOKEN', 'secret-1');
    await liveHttp({ githubTokenVariable: 'TEST_GITHUB_TOKEN' }).json('https://registry.npmjs.org/left-pad');
    expect(authHeader(fetch)).toBeNull();
  });

  it('refuses a body over the size limit', async () => {
    stubFetch('x'.repeat(2_000));
    await expect(liveHttp({ maxBytes: 1_000 }).bytes('https://registry.npmjs.org/x.tgz')).rejects.toThrow(
      'over the 1000 byte limit'
    );
  });
});
