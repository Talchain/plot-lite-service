/**
 * Sampling Engine Types
 *
 * Brief 8: PLoT — Sampling Engine & Caching
 *
 * Provides structured trace format for ISL robustness analysis.
 * Guarantees determinism for (graph_hash, seed, sampling_config_version).
 */

import type { Intervention, InferenceMode } from '../scm-lite/types.js';

/**
 * Current sampling configuration version
 * Bump this when the sampling algorithm changes to invalidate caches
 */
export const SAMPLING_CONFIG_VERSION = '1.0.0';

/**
 * Cache key components for trace caching
 * This triple guarantees determinism: same inputs → same outputs
 */
export interface TraceCacheKey {
  /** SHA-256 hash of graph topology + parameters */
  graph_hash: string;
  /** Random seed for Monte Carlo sampling */
  seed: number;
  /** Version of the sampling algorithm */
  sampling_config_version: string;
}

/**
 * Distribution statistics for a node's sampled values
 */
export interface Distribution {
  /** Arithmetic mean of samples */
  mean: number;
  /** Standard deviation of samples */
  std: number;
  /** Percentile values for distribution shape */
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /** Optional raw samples (for detailed analysis) */
  samples?: number[];
}

/**
 * Single Monte Carlo sample trace
 * Records the full state of one simulation run
 */
export interface Trace {
  /** Sample index (0 to n_samples-1) */
  sample_id: number;
  /** Final computed values for each node */
  node_values: Record<string, number>;
  /** Which edges were active in this sample (belief_exists sampling) */
  edge_mask: Record<string, boolean>;
  /** Sampled weights for active edges (belief_strength sampling) */
  edge_weights: Record<string, number>;
}

/**
 * Metadata for a simulation trace set
 */
export interface TraceMeta {
  /** SHA-256 hash of graph topology + parameters */
  graph_hash: string;
  /** Random seed used for sampling */
  seed: number;
  /** Version of the sampling algorithm */
  sampling_config_version: string;
  /** Number of samples collected */
  n_samples: number;
  /** When the simulation was run */
  timestamp: Date;
  /** Inference mode used */
  inference_mode: InferenceMode;
  /** Interventions applied (empty if none) */
  interventions: Intervention[];
  /** Optional: K requested vs K evaluated (for adaptive K) */
  k_requested?: number;
  k_converged?: boolean;
}

/**
 * Aggregate statistics computed from traces
 */
export interface TraceAggregates {
  /** Distribution statistics for each node */
  node_distributions: Record<string, Distribution>;
  /** Expected utility for each option node (for decision analysis) */
  expected_utilities: Record<string, number>;
}

/**
 * Complete simulation trace set
 * This is the primary output consumed by ISL for robustness analysis
 */
export interface SimulationTraces {
  /** Metadata about this simulation */
  meta: TraceMeta;
  /** Individual sample traces */
  traces: Trace[];
  /** Aggregate statistics */
  aggregates: TraceAggregates;
}

/**
 * Configuration for trace generation
 */
export interface TraceConfig {
  /** Random seed for determinism */
  seed: number;
  /** Number of Monte Carlo samples */
  n_samples: number;
  /** Whether to store individual traces (vs aggregates only) */
  store_traces?: boolean;
  /** Whether to store raw samples in distributions */
  store_raw_samples?: boolean;
  /** Inference mode */
  mode?: InferenceMode;
  /** Interventions to apply */
  interventions?: Intervention[];
  /** Adaptive K settings */
  adaptive_k?: boolean;
  convergence_threshold?: number;
}

/**
 * Perturbation specification for batch simulation
 */
export interface Perturbation {
  /** Unique identifier for this perturbation */
  perturbation_id: string;
  /** Parameter changes to apply: node_id or edge_id → new value */
  parameter_changes: Record<string, number>;
  /** Optional: specific edge parameter changes */
  edge_changes?: Record<string, {
    weight?: number;
    belief_exists?: number;
    belief_strength?: number;
  }>;
}

/**
 * Request for batch simulation
 */
export interface BatchSimulationRequest {
  /** Base graph to simulate */
  base_graph: {
    nodes: Array<{ id: string; label?: string; value?: number }>;
    edges: Array<{
      from: string;
      to: string;
      weight?: number;
      belief?: number;
      belief_exists?: number;
      belief_strength?: number;
    }>;
  };
  /** Base seed for determinism */
  base_seed: number;
  /** Perturbations to run */
  perturbations: Perturbation[];
  /** Simulation options */
  options: {
    /** Number of samples per simulation */
    n_samples: number;
    /** Return full traces vs aggregates only */
    return_traces: boolean;
    /** Cache results for future use */
    cache_results: boolean;
    /** Inference mode */
    mode?: InferenceMode;
    /** Interventions to apply */
    interventions?: Intervention[];
  };
}

/**
 * Response from batch simulation
 */
export interface BatchSimulationResponse {
  /** Base graph simulation results */
  base_result: SimulationTraces;
  /** Results for each perturbation */
  perturbation_results: Record<string, SimulationTraces>;
  /** IDs of perturbations that were cache hits */
  cache_hits: string[];
  /** Total computation time in milliseconds */
  computation_time_ms: number;
}

/**
 * Cache statistics for monitoring
 */
export interface TraceCacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of evictions */
  evictions: number;
  /** Hit rate (hits / (hits + misses)) */
  hit_rate: number;
  /** Current cache size */
  size: number;
  /** Maximum cache size */
  max_size: number;
}

/**
 * Sampling performance metrics
 */
export interface SamplingMetrics {
  /** Samples generated per second */
  samples_per_second: number;
  /** Cache hit rate */
  cache_hit_rate: number;
  /** Time breakdown in milliseconds */
  time_breakdown: {
    sampling_ms: number;
    propagation_ms: number;
    aggregation_ms: number;
  };
  /** Memory usage in bytes (approximate) */
  memory_usage_bytes: number;
}

/**
 * Stratified sampling configuration (optional enhancement)
 */
export interface StratifiedSamplingConfig {
  /** Enable stratified sampling */
  enabled: boolean;
  /** Number of strata per parameter */
  n_strata: number;
  /** Parameters to stratify on */
  stratify_params: string[];
}

/**
 * Importance sampling configuration (optional enhancement)
 */
export interface ImportanceSamplingConfig {
  /** Enable importance sampling */
  enabled: boolean;
  /** Target node for importance weighting */
  target_node: string;
  /** Threshold for over-sampling (values beyond this are over-sampled) */
  threshold: number;
  /** Over-sampling factor */
  oversample_factor: number;
}

/**
 * Seed sequence for perturbation sweeps
 */
export interface SeedSequence {
  /** Base seed */
  base_seed: number;
  /** Generated seeds for each perturbation */
  seeds: number[];
  /** Method used to generate seeds */
  method: 'sequential' | 'hash_based' | 'jump';
}
