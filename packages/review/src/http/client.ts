import { log } from '@pkgwarden/engine';

/** A status code and a parsed body. */
export interface HttpResponse<T> {
  readonly status: number;
  readonly body: T;
}

/** A JSON request. GET unless a method is given. */
export interface JsonRequest {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
}

/** Everything the data sources need from the network. Tests, evals and the demo swap in fixtures. */
export interface HttpClient {
  json(url: string, request?: JsonRequest, signal?: AbortSignal): Promise<HttpResponse<unknown>>;
  bytes(url: string, signal?: AbortSignal): Promise<HttpResponse<Uint8Array>>;
}

/** How the live client behaves. Names the token variable; never holds the token. */
export interface LiveHttpOptions {
  readonly userAgent?: string;
  /** Environment variable holding a GitHub token, read at the moment of each GitHub call. */
  readonly githubTokenVariable?: string;
  readonly timeoutMs?: number;
  /** Refuse bodies bigger than this. Tarballs and packuments are read fully into memory. */
  readonly maxBytes?: number;
}

/**
 * The only module that talks to the network and the only one that attaches credentials.
 * Every call has a timeout and a size cap. The GitHub token is only ever sent to api.github.com.
 */
export function liveHttp(options: LiveHttpOptions = {}): HttpClient {
  const userAgent = options.userAgent ?? 'pkgwarden (+https://github.com/chetan1029/pkgwarden)';
  const tokenVariable = options.githubTokenVariable ?? 'GITHUB_TOKEN';
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 60 * 1024 * 1024;

  async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('user-agent', userAgent);
    const target = new URL(url);
    const token = process.env[tokenVariable];
    if (token && target.hostname === 'api.github.com') headers.set('authorization', `Bearer ${token}`);
    const timeout = AbortSignal.timeout(timeoutMs);
    const started = Date.now();
    const response = await fetch(url, {
      ...init,
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    log.debug('http response', {
      method: init.method ?? 'GET',
      host: target.hostname,
      path: target.pathname,
      status: response.status,
      duration_ms: Date.now() - started,
    });
    return response;
  }

  async function readCapped(response: Response): Promise<Uint8Array> {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error(`response is ${declared} bytes, over the ${maxBytes} byte limit`);
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response is over the ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  return {
    async json(url, req = {}, signal) {
      const response = await request(
        url,
        {
          method: req.method ?? 'GET',
          headers: {
            accept: 'application/json',
            ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        },
        signal
      );
      const text = Buffer.from(await readCapped(response)).toString('utf8');
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    async bytes(url, signal) {
      const response = await request(url, { method: 'GET' }, signal);
      return { status: response.status, body: await readCapped(response) };
    },
  };
}
