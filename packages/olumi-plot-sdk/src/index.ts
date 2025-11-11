import { httpRequest, type HttpOptions } from './http.js';
import { LimitsResponse, RunRequest, RunResponse, OversizeError } from './types.js';

export { LimitsResponse, RunRequest, RunResponse, OversizeError };

export async function limits(options: HttpOptions = {}): Promise<LimitsResponse> {
  return httpRequest<LimitsResponse>('/v1/limits', options);
}

export async function run(
  request: RunRequest,
  options: HttpOptions = {}
): Promise<RunResponse> {
  const body = JSON.stringify(request);
  const bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest<RunResponse>('/v1/run', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}
