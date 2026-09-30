import type { HttpClient, HttpResponse, JsonRequest } from './client.js';

/** Answers one request in a fixture. */
export type Route = (request: JsonRequest) => HttpResponse<unknown> | HttpResponse<Uint8Array>;

/**
 * Serves canned responses and answers 404 to anything else, so tests, evals and the demo
 * never touch the network. `requests` records every URL asked for, in order.
 */
export class FixtureHttp implements HttpClient {
  readonly #routes = new Map<string, Route>();
  readonly requests: string[] = [];

  /** Registers a route. A plain value is served as a 200 JSON body. */
  on(method: 'GET' | 'POST', url: string, route: Route | unknown): this {
    const handler: Route = typeof route === 'function' ? (route as Route) : () => ({ status: 200, body: route });
    this.#routes.set(`${method} ${url}`, handler);
    return this;
  }

  #find(method: string, url: string, req: JsonRequest): HttpResponse<unknown> | HttpResponse<Uint8Array> {
    this.requests.push(`${method} ${url}`);
    const route = this.#routes.get(`${method} ${url}`);
    if (!route) return { status: 404, body: { error: `no fixture for ${method} ${url}` } };
    return route(req);
  }

  async json(url: string, req: JsonRequest = {}): Promise<HttpResponse<unknown>> {
    return this.#find(req.method ?? 'GET', url, req);
  }

  async bytes(url: string): Promise<HttpResponse<Uint8Array>> {
    const response = this.#find('GET', url, {});
    if (!(response.body instanceof Uint8Array)) return { status: response.status, body: new Uint8Array() };
    return response as HttpResponse<Uint8Array>;
  }
}
