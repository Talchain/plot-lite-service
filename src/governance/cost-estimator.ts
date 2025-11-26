/**
 * Cost Governance - Pre-run cost estimation and budget enforcement
 */

import type { Graph } from '../trust/types.js';

export interface CostEstimate {
  estimated_compute_ms: number;
  estimated_k_samples: number;
  within_budget: boolean;
  will_downgrade: boolean;
  downgrade_reason?: string;
}

export interface CostInputs {
  graph: Graph;
  requested_k?: number;
  soft_cap_k?: number;
  max_compute_ms?: number;
}

/**
 * Estimate computational cost before running
 */
export function estimateCost(inputs: CostInputs): CostEstimate {
  const {
    graph,
    requested_k = 1000,
    soft_cap_k = 5000,
    max_compute_ms = 25000, // P0.1: Aligned with Netlify proxy timeout (~26s)
  } = inputs;

  const node_count = graph.nodes.length;
  const edge_count = graph.edges.length;

  // Rough heuristic: compute_time ≈ k * (nodes + edges) * complexity_factor
  const complexity_factor = 0.5; // ms per sample per node/edge
  const estimated_compute_ms = requested_k * (node_count + edge_count) * complexity_factor;

  // Check if within budget
  const within_budget = estimated_compute_ms <= max_compute_ms;

  // Determine if downgrade needed
  let will_downgrade = false;
  let downgrade_reason: string | undefined;
  let final_k = requested_k;

  if (requested_k > soft_cap_k) {
    will_downgrade = true;
    final_k = soft_cap_k;
    downgrade_reason = `Requested k=${requested_k} exceeds soft cap (${soft_cap_k}). Automatically downgraded.`;
  } else if (!within_budget) {
    // Calculate max affordable k
    const max_affordable_k = Math.floor(max_compute_ms / ((node_count + edge_count) * complexity_factor));
    will_downgrade = true;
    final_k = Math.max(500, max_affordable_k); // Minimum 500 samples
    downgrade_reason = `Estimated ${estimated_compute_ms.toFixed(0)}ms exceeds budget (${max_compute_ms}ms). Downgraded to k=${final_k}.`;
  }

  return {
    estimated_compute_ms: will_downgrade
      ? final_k * (node_count + edge_count) * complexity_factor
      : estimated_compute_ms,
    estimated_k_samples: final_k,
    within_budget: will_downgrade || within_budget,
    will_downgrade,
    downgrade_reason,
  };
}

/**
 * Apply cost governance and return adjusted k
 */
export function enforceComputeBudget(inputs: CostInputs): {
  k: number;
  downgraded: boolean;
  reason?: string;
} {
  const estimate = estimateCost(inputs);

  return {
    k: estimate.estimated_k_samples,
    downgraded: estimate.will_downgrade,
    reason: estimate.downgrade_reason,
  };
}
