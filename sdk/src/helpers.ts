/**
 * SDK v0.6.0 Helpers
 * Utility functions for working with PLoT Lite API responses
 */

/**
 * Extract the X-Olumi-Backend header from a fetch Response
 * Works in both browser and Node.js environments
 * 
 * @param response - Fetch API Response object
 * @returns Backend mode ('fallback' | 'scm_lite') or null if header not present
 * 
 * @example
 * ```typescript
 * const response = await fetch('https://api.example.com/v1/run', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify(payload)
 * });
 * 
 * const backend = getBackendFromResponse(response);
 * console.log('Active backend:', backend); // 'fallback' or 'scm_lite'
 * ```
 */
export function getBackendFromResponse(response: Response): 'fallback' | 'scm_lite' | null {
  const header = response.headers.get('x-olumi-backend');
  if (header === 'fallback' || header === 'scm_lite') {
    return header;
  }
  return null;
}

/**
 * Extract backend from response body model_card
 * Fallback method if header is not accessible
 * 
 * @param body - Parsed JSON response body
 * @returns Backend mode or null
 * 
 * @example
 * ```typescript
 * const body = await response.json();
 * const backend = getBackendFromBody(body);
 * ```
 */
export function getBackendFromBody(body: any): 'fallback' | 'scm_lite' | null {
  const backend = body?.model_card?.backend;
  if (backend === 'fallback' || backend === 'scm_lite') {
    return backend;
  }
  return null;
}

/**
 * Check if response indicates SCM-Lite backend is active
 * 
 * @param response - Fetch API Response object
 * @returns true if SCM-Lite is active
 */
export function isScmLiteActive(response: Response): boolean {
  return getBackendFromResponse(response) === 'scm_lite';
}

/**
 * Check if response indicates fallback backend is active
 * 
 * @param response - Fetch API Response object
 * @returns true if fallback backend is active
 */
export function isFallbackActive(response: Response): boolean {
  return getBackendFromResponse(response) === 'fallback';
}
