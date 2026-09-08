import type { ProposalInput } from '../../../packages/contracts/src/ProposalInput.js';
import type { QueryInput } from '../../../packages/contracts/src/QueryInput.js';
import type { QueryResult } from '../../../packages/contracts/src/QueryResult.js';
import type { FeedbackInput } from '../../../packages/contracts/src/FeedbackInput.js';

export interface CoreClientConfig {
  baseUrl: string;
  tenantId: string;
  domainId: string;
  getAccessToken: () => Promise<string>;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class CoreClientError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`Knowledge service request failed (${status}, ${code})`);
  }
}

/** Identity is application configuration, never a model-supplied tool argument. */
export class CoreClient {
  private readonly config: CoreClientConfig;
  private readonly abort = new AbortController();

  constructor(config: CoreClientConfig) {
    const base = new URL(config.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) {
      throw new Error('Use HTTPS or a loopback development endpoint');
    }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      throw new Error('Configure an origin without embedded credentials or paths');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(config.tenantId) || !uuid.test(config.domainId)) throw new Error('Invalid domain context');
    this.config = { ...config, baseUrl: base.origin, timeoutMs: config.timeoutMs ?? 10000 };
  }

  dispose(): void { this.abort.abort(); }

  private async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await this.config.getAccessToken();
    const signals = [this.abort.signal, AbortSignal.timeout(this.config.timeoutMs!)];
    if (signal) signals.push(signal);
    const response = await (this.config.fetch ?? globalThis.fetch)(
      `${this.config.baseUrl}/v1/domains/${this.config.domainId}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Tenant-ID': this.config.tenantId, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any(signals),
      },
    );
    if (!response.ok) {
      // Do not retain raw server error payloads, which may contain source data.
      throw new CoreClientError(response.status, 'CORE_REQUEST_FAILED');
    }
    return await response.json() as T;
  }

  query(input: QueryInput, signal?: AbortSignal): Promise<QueryResult> {
    return this.request('/query', input, signal);
  }
  inspectConcept(id: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(`/concepts/${encodeURIComponent(id)}`, undefined, signal);
  }
  propose(input: ProposalInput, signal?: AbortSignal): Promise<unknown> {
    return this.request('/proposals', input, signal);
  }
  feedback(episodeId: string, input: FeedbackInput, signal?: AbortSignal): Promise<unknown> {
    return this.request(`/episodes/${encodeURIComponent(episodeId)}/feedback`, input, signal);
  }
}
