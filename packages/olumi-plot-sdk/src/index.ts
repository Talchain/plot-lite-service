import { httpRequest, type HttpOptions } from './http.js';
import { LimitsResponse, RunRequest, RunResponse, OversizeError } from './types.js';
import {
  classifyEvidenceFreshness,
  summarizeEvidenceFreshness,
  type EvidenceFreshness,
  type EvidenceFreshnessBucket,
  type EvidenceFreshnessSummary,
  type EvidenceFreshnessThresholds,
  type EvidenceSample,
} from './evidence.js';

export {
  LimitsResponse,
  RunRequest,
  RunResponse,
  OversizeError,
  classifyEvidenceFreshness,
  summarizeEvidenceFreshness,
  type EvidenceFreshness,
  type EvidenceFreshnessBucket,
  type EvidenceFreshnessSummary,
  type EvidenceFreshnessThresholds,
  type EvidenceSample,
};

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

export async function runBatch(options: {
  items: Array<{
    graph: { nodes: any[]; edges: any[] };
    seed?: number;
    k_samples?: number;
  }>;
} & HttpOptions) {
  const { items, ...httpOpts } = options;
  const body = JSON.stringify({ items });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/run_batch', {
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

export async function optimise(options: {
  graph: { nodes: any[]; edges: any[] };
  budget: number;
  actions: Array<{
    id: string;
    cost: number;
    do: Array<{ node_id: string; set_to: number }>;
  }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
  seed?: number;
  constraints?: {
    budget?: number;
    must?: string[];
    must_not?: string[];
    max_changed_nodes?: number;
  };
} & HttpOptions) {
  const { graph, budget, actions, objective, seed, constraints, ...httpOpts } = options;
  const body = JSON.stringify({ graph, budget, actions, objective, seed, constraints });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/optimise', {
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

export async function fitPreferences(options: {
  pairs: Array<{ winner: string; loser: string; strength: number }>;
  prior: { weights: Record<string, number> };
} & HttpOptions) {
  const { pairs, prior, ...httpOpts } = options;
  const body = JSON.stringify({ pairs, prior });
  
  let bodyKb: number;
  if (typeof TextEncoder !== 'undefined') {
    bodyKb = new TextEncoder().encode(body).length / 1024;
  } else {
    bodyKb = Buffer.byteLength(body, 'utf8') / 1024;
  }
  
  if (bodyKb > 96) {
    throw new OversizeError(96);
  }
  
  return httpRequest('/v1/preferences/fit', {
    ...httpOpts,
    requestId: httpOpts.requestId || genReqId(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}
