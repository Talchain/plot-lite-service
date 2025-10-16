/**
 * Adaptive K - Deterministic sample count based on graph complexity
 * Scales samples sensibly without surprises
 */

export interface AdaptiveKConfig {
  base: number;        // Base K (default: 250)
  per_edge: number;    // Additional K per edge (default: 25)
  per_node: number;    // Additional K per node (default: 10)
  min: number;         // Minimum K (default: 250)
  max: number;         // Maximum K (default: 1000)
}

export interface AdaptiveKResult {
  k_samples: number;
  reason: string;
  clamped: boolean;
  raw_k: number;
}

const DEFAULT_CONFIG: AdaptiveKConfig = {
  base: 250,
  per_edge: 25,
  per_node: 10,
  min: 250,
  max: 1000,
};

/**
 * Compute adaptive K based on graph complexity
 * Formula: K = clamp(base + per_edge * edges + per_node * nodes, min, max)
 * 
 * Determinism rule: same input + seed => same K plan => same hashes
 */
export function computeAdaptiveK(
  node_count: number,
  edge_count: number,
  config: Partial<AdaptiveKConfig> = {}
): AdaptiveKResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Compute raw K
  const raw_k = cfg.base + cfg.per_edge * edge_count + cfg.per_node * node_count;

  // Clamp to bounds
  const k_samples = Math.max(cfg.min, Math.min(cfg.max, raw_k));
  const clamped = k_samples !== raw_k;

  // Build reason
  let reason: string;
  if (clamped) {
    if (k_samples === cfg.min) {
      reason = `Adaptive K: ${k_samples} (clamped to minimum, graph has ${node_count} nodes, ${edge_count} edges)`;
    } else {
      reason = `Adaptive K: ${k_samples} (clamped to maximum, graph has ${node_count} nodes, ${edge_count} edges)`;
    }
  } else {
    reason = `Adaptive K: ${k_samples} (${cfg.base} base + ${cfg.per_edge}×${edge_count} edges + ${cfg.per_node}×${node_count} nodes)`;
  }

  return {
    k_samples,
    reason,
    clamped,
    raw_k,
  };
}

/**
 * Determine K for a request
 * If k_samples provided in request, use it (user override)
 * Otherwise, compute adaptive K
 */
export function determineK(
  node_count: number,
  edge_count: number,
  requested_k?: number,
  config?: Partial<AdaptiveKConfig>
): AdaptiveKResult {
  // User override takes precedence
  if (requested_k !== undefined && requested_k > 0) {
    return {
      k_samples: requested_k,
      reason: `User-specified K: ${requested_k}`,
      clamped: false,
      raw_k: requested_k,
    };
  }

  // Compute adaptive K
  return computeAdaptiveK(node_count, edge_count, config);
}

/**
 * Validate K is within acceptable bounds
 */
export function validateK(k: number, config: Partial<AdaptiveKConfig> = {}): {
  valid: boolean;
  reason?: string;
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (k < cfg.min) {
    return {
      valid: false,
      reason: `K too low: ${k} < ${cfg.min}`,
    };
  }

  if (k > cfg.max) {
    return {
      valid: false,
      reason: `K too high: ${k} > ${cfg.max}`,
    };
  }

  return { valid: true };
}

/**
 * Get default config (for testing/documentation)
 */
export function getDefaultConfig(): AdaptiveKConfig {
  return { ...DEFAULT_CONFIG };
}
