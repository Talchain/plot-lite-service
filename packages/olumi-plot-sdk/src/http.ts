export interface HttpOptions {
  baseUrl?: string;
  scmLite?: boolean;
  idempotencyKey?: string;
}

const DEFAULT_BASE_URL = 'https://plot-lite-service.onrender.com';

export async function httpRequest<T>(
  path: string,
  options: HttpOptions & RequestInit = {}
): Promise<T> {
  const { baseUrl = DEFAULT_BASE_URL, scmLite, idempotencyKey, ...fetchOptions } = options;
  
  const headers = new Headers(fetchOptions.headers);
  headers.set('User-Agent', 'olumi-plot-sdk/0.1.0');
  
  if (scmLite) {
    headers.set('x-scm-lite', '1');
  }
  
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }
  
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers,
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}
