import { httpRequest, type HttpOptions } from './http.js';
import { LimitsResponse, RunRequest, RunResponse, OversizeError } from './types.js';

export { LimitsResponse, RunRequest, RunResponse, OversizeError };

// Generate request ID (browser-safe)
function genReqId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function limits(options: HttpOptions = {}): Promise<LimitsResponse> {
  return httpRequest<LimitsResponse>('/v1/limits', {
    ...options,
    requestId: options.requestId || genReqId()
  });
}

export async function run(
  request: RunRequest,
  options: HttpOptions = {}
): Promise<RunResponse> {
  const body = JSON.stringify(request);
  
  // Browser-safe size calculation
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest<RunResponse>('/v1/run', {
    ...options,
    requestId: options.requestId || genReqId(),
    idempotencyKey: options.idempotencyKey || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

export async function compare(options: {
  graphs: Array<{ graph: { nodes: any[]; edges: any[] }; label: string }>;
  seed?: number;
} & HttpOptions) {
  const { graphs, seed, ...httpOpts } = options;
  const body = JSON.stringify({ graphs, seed });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/compare', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

export async function inspect(options: {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
} & HttpOptions) {
  const { graph, seed, ...httpOpts } = options;
  const body = JSON.stringify({ graph, seed });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/inspect', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

export async function score(options: {
  graph: { nodes: any[]; edges: any[] };
  utilities: {
    type: 'linear';
    weights: Record<string, number>;
    risk?: { attitude: 'averse' | 'neutral' | 'seeking' };
  };
  seed?: number;
} & HttpOptions) {
  const { graph, utilities, seed, ...httpOpts } = options;
  const body = JSON.stringify({ graph, utilities, seed });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/score', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    idempotencyKey: httpOpts.idempotencyKey || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

export async function intervene(options: {
  graph: { nodes: any[]; edges: any[] };
  do: Array<{ node_id: string; set_to: number }>;
  seed?: number;
} & HttpOptions) {
  const { graph, do: doOps, seed, ...httpOpts } = options;
  const body = JSON.stringify({ graph, do: doOps, seed });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/intervene', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    idempotencyKey: httpOpts.idempotencyKey || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

export async function evidence(options: {
  graph: { nodes: any[]; edges: any[] };
  priors: Array<{
    node_id: string;
    mean: number;
    variance: number;
    source?: string;
  }>;
  seed?: number;
} & HttpOptions) {
  const { graph, priors, seed, ...httpOpts } = options;
  const body = JSON.stringify({ graph, priors, seed });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/evidence', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    idempotencyKey: httpOpts.idempotencyKey || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}
