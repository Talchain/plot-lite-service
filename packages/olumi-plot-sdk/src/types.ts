export interface LimitsResponse {
  schema: 'limits.v1';
  max_nodes: number;
  max_edges: number;
  max_body_kb: number;
  rate_limit_rpm: number;
  flags: {
    scm_lite: 0 | 1;
  };
}

export interface RunRequest {
  graph: {
    nodes: Array<{ id: string; label: string; [key: string]: any }>;
    edges: Array<{ from: string; to: string; [key: string]: any }>;
  };
  seed?: number;
  k_samples?: number;
}

export interface RunResponse {
  schema: 'report.v1';
  result: {
    response_hash: string;
    summary: { p10: number; p50: number; p90: number };
    [key: string]: any;
  };
  [key: string]: any;
}

export class OversizeError extends Error {
  constructor(public maxBodyKb: number) {
    super(`Request body exceeds ${maxBodyKb} KB limit`);
    this.name = 'OversizeError';
  }
}
