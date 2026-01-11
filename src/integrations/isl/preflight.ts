/**
 * ISL Pre-flight Validation
 *
 * Validates graph structure before making ISL /robustness/analyze/v2 calls.
 * Returns separate statuses for edge and factor sensitivity to enable
 * granular fallback decisions.
 */

import type { Graph, GraphEdge, GraphNode } from '../../trust/types.js';
import type { ISLPreflightResult } from './types/plot-types.js';
import type { ISLParameterUncertainty } from './types/isl-types.js';

/**
 * Check if an edge has uncertainty data for sensitivity analysis
 *
 * Edge sensitivity requires:
 * - exists_probability (0 < p < 1) for existence sensitivity, OR
 * - strength.std > 0 (or belief_strength < 1) for magnitude sensitivity
 */
function edgeHasUncertainty(edge: GraphEdge): boolean {
  // Check for explicit exists_probability
  const hasExistenceUncertainty =
    edge.belief_exists !== undefined &&
    edge.belief_exists > 0 &&
    edge.belief_exists < 1;

  // Check for strength uncertainty (EdgeV2.2 strength_std or EdgeV2 belief_strength)
  const hasStrengthUncertainty =
    (edge.strength_std !== undefined && edge.strength_std > 0) ||
    (edge.belief_strength !== undefined && edge.belief_strength < 1);

  // Legacy belief field as fallback
  const hasLegacyUncertainty =
    edge.belief !== undefined &&
    edge.belief > 0 &&
    edge.belief < 1;

  return hasExistenceUncertainty || hasStrengthUncertainty || hasLegacyUncertainty;
}

/**
 * Check if a node is a factor with observed state
 */
function isFactorWithValue(node: GraphNode): boolean {
  return (
    node.kind === 'factor' &&
    node.observed_state !== undefined &&
    node.observed_state.value !== undefined
  );
}

/**
 * Build parameter uncertainties from graph factor nodes
 *
 * Creates uncertainty specifications for factor nodes that have observed_state.
 * Uses a default normal distribution with 10% coefficient of variation.
 */
export function buildParameterUncertainties(graph: Graph): ISLParameterUncertainty[] {
  const uncertainties: ISLParameterUncertainty[] = [];

  for (const node of graph.nodes) {
    if (isFactorWithValue(node)) {
      const value = node.observed_state!.value;
      // Default: normal distribution with 10% CV
      const std = Math.abs(value) * 0.1 || 0.1; // Avoid zero std

      uncertainties.push({
        node_id: node.id,
        distribution: 'normal',
        mean: value,
        std,
      });
    }
  }

  return uncertainties;
}

/**
 * Validate graph before making ISL robustness/analyze/v2 call
 *
 * Returns separate statuses for edge and factor sensitivity analysis.
 * This enables granular decisions about what data to request from ISL.
 *
 * @param graph - The decision graph
 * @param parameterUncertainties - Optional pre-built parameter uncertainties
 * @returns Pre-flight validation result
 *
 * @example
 * ```typescript
 * const preflight = validateBeforeISL(graph);
 *
 * if (!preflight.canCallISL) {
 *   // Skip ISL call entirely
 *   return createFallbackRobustnessAnalysis('No valid analysis possible');
 * }
 *
 * if (preflight.edge_sensitivity_status === 'skipped_no_edges') {
 *   // Can still call ISL for factor sensitivity only
 * }
 * ```
 */
export function validateBeforeISL(
  graph: Graph,
  parameterUncertainties?: ISLParameterUncertainty[]
): ISLPreflightResult {
  const skipReasons: string[] = [];

  // === Edge Sensitivity Validation ===
  const hasEdges = graph.edges.length > 0;
  const edgesWithUncertainty = graph.edges.filter(edgeHasUncertainty);
  const hasEdgeUncertainty = edgesWithUncertainty.length > 0;

  let edgeStatus: ISLPreflightResult['edge_sensitivity_status'];

  if (!hasEdges) {
    edgeStatus = 'skipped_no_edges';
    skipReasons.push('No edges in graph');
  } else if (!hasEdgeUncertainty) {
    edgeStatus = 'skipped_missing_uncertainty';
    skipReasons.push(
      `No edges with uncertainty (${graph.edges.length} edges, 0 with belief_exists < 1 or strength_std)`
    );
  } else {
    edgeStatus = 'available';
  }

  // === Factor Sensitivity Validation ===
  const factorNodes = graph.nodes.filter((n) => n.kind === 'factor');
  const factorsWithValues = graph.nodes.filter(isFactorWithValue);

  // Use provided uncertainties or build from graph
  const uncertainties = parameterUncertainties ?? buildParameterUncertainties(graph);

  let factorStatus: ISLPreflightResult['factor_sensitivity_status'];

  if (factorsWithValues.length === 0) {
    factorStatus = 'skipped_no_factor_values';
    skipReasons.push(
      `No factor nodes with observed_state (${factorNodes.length} factor nodes, 0 with values)`
    );
  } else if (uncertainties.length === 0) {
    factorStatus = 'skipped_no_parameter_uncertainties';
    skipReasons.push('No parameter uncertainties provided or derivable');
  } else {
    factorStatus = 'available';
  }

  // === Overall ISL Call Decision ===
  // Can call ISL if either edge OR factor sensitivity is available
  const canCallISL = edgeStatus === 'available' || factorStatus === 'available';

  return {
    canCallISL,
    edge_sensitivity_status: edgeStatus,
    factor_sensitivity_status: factorStatus,
    skipReasons,
  };
}

/**
 * Log pre-flight validation result for observability
 */
export function logPreflightResult(
  preflight: ISLPreflightResult,
  requestId: string
): void {
  const entry = {
    level: 'info',
    time: Date.now(),
    event: 'isl_preflight_validation',
    request_id: requestId,
    can_call_isl: preflight.canCallISL,
    edge_sensitivity_status: preflight.edge_sensitivity_status,
    factor_sensitivity_status: preflight.factor_sensitivity_status,
    skip_reasons: preflight.skipReasons,
  };
  console.log(JSON.stringify(entry));
}
