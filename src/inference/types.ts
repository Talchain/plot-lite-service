/**
 * Inference Engine Types
 * 
 * Defines the contract for pluggable inference modes.
 */

import type { Graph } from '../trust/types.js';

export interface InferenceConfig {
  seed: number;
  k_samples: number;
  outcome_node: string;
  baseline_value: number;
  priors?: Record<string, number | { mean: number; sd: number }>;
  // Adaptive K early-stopping
  adaptiveK?: boolean;
  convergenceThreshold?: number; // e.g., 0.01 = 1%
}

export interface InferenceResult {
  conservative: { outcome: number };
  most_likely: { outcome: number };
  optimistic: { outcome: number };
  meta?: {
    unique_graphs?: number;
    sign_stability?: number;
    bma_hash?: string;
    K_evaluated?: number;
    K_requested?: number;
    K_converged?: boolean;
    engine?: string; // Identifies which inference engine produced the result
  };
}

export interface InferenceEngine {
  /**
   * Run inference on a graph
   */
  run(graph: Graph, config: InferenceConfig): Promise<InferenceResult> | InferenceResult;
  
  /**
   * Engine name for logging/debugging
   */
  name: string;
}
