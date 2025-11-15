// Core types for PLoT Lite SDK

export interface Graph {
  nodes: Array<{ id: string; label: string; [key: string]: any }>;
  edges: Array<{ from: string; to: string; weight?: number; [key: string]: any }>;
}

export type Prior = number | { mean: number; sd: number };
export type Priors = Record<string, Prior>;

export interface Evidence {
  node_id: string;
  source: string;
  note?: string;
  weight?: number;
}

export interface RunRequest {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
  query?: any;
  constraints?: any;
  inference_mode?: 'model_based' | 'model_of_inference';
  include_debug?: boolean;
  priors?: Priors;
  evidence?: Evidence[];
}

export interface RunResponse {
  schema: 'run.v1';
  summary: { p10: number; p50: number; p90: number };
  confidence: number;
  meta: {
    seed: number;
    evidence_applied?: Array<{ node_id: string; source: string; weight?: number }>;
    [key: string]: any;
  };
  model_card: {
    seed: number;
    response_hash: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface CompareRequest {
  graphs: Graph[];
  seed?: number;
  labels?: string[];
}

export interface CompareResponse {
  schema: 'compare.v1';
  results: Array<{
    label: string;
    summary: { p10: number; p50: number; p90: number };
    confidence: number;
  }>;
  model_card: {
    seed: number;
    response_hash: string;
  };
}

export interface InspectRequest {
  graph: Graph;
  seed?: number;
}

export interface InspectResponse {
  schema: 'inspect.v1';
  identifiability: string;
  factors: any;
  model_card: {
    seed: number;
    response_hash: string;
  };
}

export interface InterveneRequest {
  graph: Graph;
  actions: Array<{ node_id: string; set_to: number }>;
  outcome_node: string;
  seed?: number;
}

export interface InterveneResponse {
  schema: 'intervene.v1';
  baseline: { summary: { p10: number; p50: number; p90: number } };
  counterfactual: { summary: { p10: number; p50: number; p90: number } };
  delta: { p10: number; p50: number; p90: number };
  model_card: {
    seed: number;
    actions_hash: string;
  };
  response_hash: string;
}

export interface OptimiseRequest {
  graph: Graph;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: {
    type: 'utility_linear';
    weights: Record<string, number>;
  };
  seed?: number;
  constraints?: any;
  priors?: Priors;
  evidence?: Evidence[];
}

export interface OptimiseResponse {
  schema: 'optimise.v1';
  selected_actions: string[];
  total_cost: number;
  expected_utility: number;
  model_card: {
    seed: number;
    response_hash: string;
  };
}

export interface RunBundleRequest {
  base_graph: Graph;
  deltas: Array<{
    label: string;
    nodes?: Array<{ id: string; [key: string]: any }>;
    edges?: Array<{ from: string; to: string; [key: string]: any }>;
  }>;
  seed?: number;
  priors?: Priors;
  evidence?: Evidence[];
}

export interface RunBundleResponse {
  schema: 'run_bundle.v1';
  results: Array<{
    label: string;
    summary: { p10: number; p50: number; p90: number };
    confidence: number;
  }>;
  model_card: {
    seed: number;
    response_hash: string;
  };
}

export interface SliceOverride {
  slice: string;
  nodes?: Array<{ id: string; [key: string]: any }>;
  edges?: Array<{ from: string; to: string; [key: string]: any }>;
}

export interface RunTimeslicesRequest {
  graph: Graph;
  timeslices: string[];
  slice_overrides?: SliceOverride[];
  priors?: Priors;
  evidence?: Evidence[];
  seed?: number;
}

export interface RunTimeslicesResponse {
  schema: 'run_timeslices.v1';
  results: Array<{
    slice: string;
    summary: { p10: number; p50: number; p90: number };
    confidence: number;
  }>;
  model_card: {
    seed: number;
    response_hash: string;
    timeslices_count: number;
  };
  meta?: {
    evidence_applied?: Array<{ node_id: string; source: string; weight?: number }>;
  };
}

export interface LimitsResponse {
  max_nodes: number;
  max_edges: number;
  max_payload_bytes: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime_seconds: number;
  [key: string]: any;
}

export interface ClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
