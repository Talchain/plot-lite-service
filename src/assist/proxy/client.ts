/**
 * Assistants Proxy Client
 *
 * HTTP client for forwarding requests to the standalone assistants service.
 * Includes retry logic with jittered backoff, timeout enforcement, and
 * structured telemetry.
 */

import { getProxyConfig } from './config.js';

/**
 * Proxy request options
 */
export interface ProxyRequestOptions {
  method: 'GET' | 'POST' | 'HEAD';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  requestId?: string;
  skipRetry?: boolean;
}

/**
 * Proxy response
 */
export interface ProxyResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  latencyMs: number;
  retried: boolean;
  upstream_url: string;
}

/**
 * Proxy error with context
 */
export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly upstream_url?: string,
    public readonly latencyMs?: number,
    public readonly retried?: boolean
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

/**
 * Jittered exponential backoff delay
 */
function getBackoffDelay(attempt: number): number {
  const baseMs = 100;
  const maxMs = 1000;
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = Math.random() * 0.3 * exponential; // ±30% jitter
  return Math.floor(exponential + jitter);
}

/**
 * Safe header extraction (lowercase keys)
 */
function extractSafeHeaders(response: Response): Record<string, string> {
  const safe: Record<string, string> = {};
  const allowedHeaders = ['content-type', 'x-request-id', 'x-trace-id', 'retry-after'];

  response.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (allowedHeaders.includes(lowerKey)) {
      safe[lowerKey] = value;
    }
  });

  return safe;
}

/**
 * Execute a single HTTP request attempt
 */
async function executeRequest(
  url: string,
  opts: ProxyRequestOptions,
  signal: AbortSignal
): Promise<{ status: number; body: unknown; headers: Record<string, string>; latencyMs: number }> {
  const startMs = Date.now();

  const requestHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'plot-engine/proxy',
    ...opts.headers,
  };

  if (opts.requestId) {
    requestHeaders['x-request-id'] = opts.requestId;
  }

  const fetchOpts: RequestInit = {
    method: opts.method,
    headers: requestHeaders,
    signal,
  };

  if (opts.body && (opts.method === 'POST')) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  const response = await fetch(url, fetchOpts);
  const latencyMs = Date.now() - startMs;

  // Parse response body
  const contentType = response.headers.get('content-type') || '';
  let body: unknown;

  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return {
    status: response.status,
    body,
    headers: extractSafeHeaders(response),
    latencyMs,
  };
}

/**
 * Proxy a JSON request to the assistants service.
 * Includes retry logic with jittered backoff for 5xx and network errors.
 *
 * @throws ProxyError on timeout, network failure, or 5xx after retries
 */
export async function proxyRequest(opts: ProxyRequestOptions): Promise<ProxyResponse> {
  const config = getProxyConfig();

  if (!config.enabled) {
    throw new ProxyError(
      'Assistants proxy is disabled',
      'PROXY_DISABLED',
      503
    );
  }

  const url = `${config.baseUrl}${opts.path}`;
  const timeoutMs = opts.timeoutMs || config.timeoutMs;
  const maxAttempts = opts.skipRetry ? 1 : (config.retries + 1);

  let lastError: Error | null = null;
  let retried = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Add backoff delay for retries
    if (attempt > 0) {
      retried = true;
      const delayMs = getBackoffDelay(attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Create abort controller for this attempt
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await executeRequest(url, opts, controller.signal);
      clearTimeout(timeoutHandle);

      // Success or non-retryable error
      if (result.status < 500) {
        return {
          ...result,
          retried,
          upstream_url: url,
        };
      }

      // 5xx error - retry if attempts remain
      lastError = new Error(`Upstream returned ${result.status}`);

      // If this was the last attempt, return the error response
      if (attempt === maxAttempts - 1) {
        return {
          ...result,
          retried,
          upstream_url: url,
        };
      }

      // Otherwise continue to retry
      continue;

    } catch (err: any) {
      clearTimeout(timeoutHandle);

      if (err.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeoutMs}ms`);
      } else {
        lastError = err;
      }

      // If this was the last attempt, throw
      if (attempt === maxAttempts - 1) {
        throw new ProxyError(
          `Upstream request failed after ${maxAttempts} attempts: ${(lastError && lastError.message) || 'unknown error'}`,
          'UPSTREAM_FAILURE',
          undefined,
          url,
          timeoutMs,
          retried
        );
      }

      // Otherwise continue to retry
      continue;
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw new ProxyError(
    `Upstream request failed: ${(lastError && lastError.message) || 'unknown error'}`,
    'UPSTREAM_FAILURE',
    undefined,
    url,
    undefined,
    retried
  );
}

/**
 * Lightweight upstream health check.
 * Non-blocking with short timeout; returns status without throwing.
 */
export async function checkUpstreamHealth(): Promise<'ok' | 'degraded' | 'down'> {
  const config = getProxyConfig();

  if (!config.enabled) {
    return 'down';
  }

  try {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 100); // 100ms timeout

    const response = await fetch(`${config.baseUrl}/health`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutHandle);

    return response.ok ? 'ok' : 'degraded';
  } catch (err) {
    return 'down';
  }
}
