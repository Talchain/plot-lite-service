/**
 * SCM-Lite Types
 * Structural Causal Model approximation with edge masking
 */

export interface Node {
  id: string;
  label?: string;
}

export interface Edge {
  from: string;
  to: string;
  belief?: number; // [0,1] edge existence probability; default 0.7
  weight?: number; // β coefficient; default 1.0
}

export interface DAG {
  nodes: Node[];
  edges: Edge[];
}

export interface Belief {
  edge: string; // "from->to"
  probability: number;
}

export interface KernelConfig {
  seed: number;
  K: number; // number of edge masks to sample
  maxNodes: number; // hard cap (default 12)
  maxEdges: number; // hard cap (default 20)
  beliefDefault: number; // default edge belief (default 0.7)
  // Adaptive K early-stopping
  adaptiveK?: boolean; // enable early stopping when p50 converges
  convergenceThreshold?: number; // percentage threshold (e.g., 0.01 = 1%)
  kStep?: number; // batch size for convergence checks (default 8)
  kMin?: number; // minimum samples before checking convergence (default 16)
}

export interface KernelResult {
  target: string; // target node id
  quantiles: {
    p10: number;
    p50: number;
    p90: number;
  };
  confidence: 'low' | 'medium' | 'high';
  bma_hash: string; // hash over K-wise canonical buffer
  meta: {
    K_evaluated: number;
    K_requested?: number; // original K before early stopping
    K_converged?: boolean; // true if stopped early due to convergence
    unique_graphs: number;
    sign_stability: number; // [0,1]
    identified_paths: number;
  };
}

export interface SeededRNG {
  next(): number; // [0,1)
  nextInt(max: number): number; // [0, max)
  jump(): void; // advance to next independent stream
}
