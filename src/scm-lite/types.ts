/**
 * SCM-Lite Types
 * Structural Causal Model approximation with edge masking
 */

export interface Node {
  id: string;
  label?: string;
}

/** Edge function type for non-linear relationships (includes EdgeV2 additions) */
export type EdgeFunctionType = 'linear' | 'diminishing_returns' | 'threshold' | 's_curve' | 'noisy_or' | 'logistic';

/** Alias for EdgeFunctionType - used in EdgeV2 schema */
export type FunctionalForm = EdgeFunctionType;

/** Parameters for non-linear edge functions */
export interface EdgeFunctionParams {
  k?: number;         // Rate parameter (diminishing, s_curve, logistic)
  threshold?: number; // Threshold value (threshold, logistic)
  midpoint?: number;  // S-curve midpoint
  slope?: number;     // Post-threshold slope
}

/**
 * Edge interface supporting both EdgeV1 and EdgeV2 schemas
 *
 * EdgeV1 (legacy): Uses single 'belief' field
 * EdgeV2 (dual beliefs): Uses 'belief_exists' + 'belief_strength'
 */
export interface Edge {
  /** Optional edge identifier */
  id?: string;
  from: string;
  to: string;
  /** @deprecated Use belief_exists. Edge existence probability [0,1]; default 0.7 */
  belief?: number;
  /** β coefficient; default 1.0 */
  weight?: number;
  /** @deprecated Use functional_form. Non-linear function (default: linear) */
  function_type?: EdgeFunctionType;
  /** How effect propagates (EdgeV2 schema) */
  functional_form?: FunctionalForm;
  /** Parameters for non-linear edge functions */
  function_params?: EdgeFunctionParams;

  // EdgeV2 dual beliefs
  /** Confidence that this edge exists at all (0-1). EdgeV2 schema. */
  belief_exists?: number;
  /** Confidence in weight precision (0-1). EdgeV2 schema. */
  belief_strength?: number;
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
  // EdgeV2 dual beliefs defaults
  beliefStrengthDefault?: number; // default belief_strength (default 0.8)
  // Adaptive K early-stopping
  adaptiveK?: boolean; // enable early stopping when p50 converges
  convergenceThreshold?: number; // percentage threshold (e.g., 0.01 = 1%)
  kStep?: number; // batch size for convergence checks (default 8)
  kMin?: number; // minimum samples before checking convergence (default 16)
  // Intervention semantics (do-operator)
  interventions?: Intervention[]; // nodes to intervene on with their values
  mode?: InferenceMode; // 'interventional' (default) or 'observational'
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
    // Intervention semantics
    inference_mode?: InferenceMode; // 'interventional' or 'observational'
    intervention_count?: number; // number of nodes intervened on
  };
}

export interface SeededRNG {
  next(): number; // [0,1)
  nextInt(max: number): number; // [0, max)
  jump(): void; // advance to next independent stream
}

/**
 * Intervention specification for do-operator semantics
 *
 * Pearl's do-calculus: When we intervene on X, we replace the structural
 * equation for X with a constant, effectively removing X from its parents'
 * influence while preserving X's influence on its children.
 *
 * Original: X = f(Parents(X), U_x)
 * Intervention: X = x (constant)
 */
export interface Intervention {
  /** Node ID to intervene on */
  node_id: string;
  /** Value to set the node to (cuts all incoming edges) */
  value: number;
}

/**
 * Inference mode for causal analysis
 *
 * - 'interventional': P(Y | do(X)) - cutting incoming edges to intervention targets
 * - 'observational': P(Y | X) - conditioning on observed values (default)
 */
export type InferenceMode = 'interventional' | 'observational';
