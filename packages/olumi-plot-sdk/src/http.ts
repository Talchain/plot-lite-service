export interface HttpOptions {
  baseUrl?: string;
  scmLite?: boolean;
  idempotencyKey?: string;
  requestId?: string;
}

const DEFAULT_BASE_URL = 'https://plot-lite-service.onrender.com';
const VERSION = '0.2.0';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

export async function httpRequest<T>(
  path: string,
  options: HttpOptions & RequestInit = {}
): Promise<T> {
  const { baseUrl = DEFAULT_BASE_URL, scmLite, idempotencyKey, requestId, ...fetchOptions } = options;
  
  const headers = new Headers(fetchOptions.headers);
  headers.set('x-olumi-sdk', `olumi-plot-sdk/${VERSION}`);
  
  if (!isBrowser) {
    headers.set('User-Agent', `olumi-plot-sdk/${VERSION}`);
  }
  
  if (scmLite) headers.set('x-scm-lite', '1');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  if (requestId) headers.set('X-Request-Id', requestId);
  
  const response = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers });
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const delayMs = parseInt(retryAfter, 10) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      const retryResponse = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers });
      if (!retryResponse.ok) throw new Error(`HTTP ${retryResponse.status}`);
      return retryResponse.json();
    }
  }
  
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}
