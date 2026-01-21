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
 *
 * Supports both nested (strength.std) and flat (strength_std) field formats
 * for compatibility with CEE V3 which outputs flat fields.
 */
export function edgeHasUncertainty(edge: GraphEdge): boolean {
  // Cast to any to access properties from multiple edge formats
  // Preflight may receive upstream (GraphEdge) or normalized (EngineEdgeV3) edges
  const e = edge as any;

  // Check for existence uncertainty - support multiple field names
  // exists_probability (normalized EngineEdgeV3), belief_exists (upstream EdgeV2), belief (legacy EdgeV1)
  const existsProb = e.exists_probability ?? e.belief_exists ?? e.belief ?? 1.0;
  const hasExistenceUncertainty = existsProb > 0 && existsProb < 1;

  // Check for strength uncertainty - support nested AND flat formats
  // Nested: edge.strength.std (normalized EngineEdgeV3 format)
  // Flat: edge.strength_std (CEE V3 / EdgeV2.2 format)
  const strengthStd = e.strength?.std ?? e.strength_std ?? 0;
  const hasStrengthUncertainty =
    strengthStd > 0 ||
    (e.belief_strength !== undefined && e.belief_strength < 1);

  return hasExistenceUncertainty || hasStrengthUncertainty;
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
 * This enables ISL to compute factor_sensitivity scores.
 *
 * Standard deviation calculation priority:
 * 1. Use observed_state.std if present and > 0
 * 2. For binary factors (0/1 range): use 0.3
 * 3. Use 15% of |observed_state.value| if value != 0
 * 4. Fallback: 0.5
 *
 * All std values have a floor of 0.1 to ensure meaningful sensitivity.
 */
export function buildParameterUncertainties(graph: Graph): ISLParameterUncertainty[] {
  const uncertainties: ISLParameterUncertainty[] = [];

  for (const node of graph.nodes) {
    if (isFactorWithValue(node)) {
      const value = node.observed_state!.value;
      const observedStd = node.observed_state!.std;

      // Detect binary factors using strong signals only
      const isBinary = isBinaryFactorNode(node);

      let std: number;

      // Priority 1: Use observed_state.std if present and meaningful
      // Cap at 2.0 to prevent extreme values from destabilizing ISL
      if (observedStd !== undefined && observedStd > 0) {
        std = Math.min(observedStd, 2.0);
        if (observedStd > 2.0) {
          console.warn(`[PARAMETER_UNCERTAINTY] node_id=${node.id} observed_state.std=${observedStd} capped to 2.0`);
        }
      }
      // Priority 2: Binary factors get std = 0.3
      else if (isBinary) {
        std = 0.3;
      }
      // Priority 3: 15% of absolute value for non-zero values
      else if (value !== 0) {
        std = Math.abs(value) * 0.15;
      }
      // Priority 4: Fallback for zero-valued continuous factors
      else {
        std = 0.5;
      }

      // Floor at 0.1 to ensure meaningful sensitivity
      std = Math.max(0.1, std);

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
 * Detect if a factor node is binary using strong signals.
 * Avoids misclassifying continuous factors (e.g., "Number of Developers Hired" = 0) as binary.
 *
 * Binary detection signals (in order):
 * 1. Explicit range [0,1]
 * 2. Label contains explicit binary markers: "(0/1)", "yes/no", "true/false"
 * 3. Unit suggests boolean: "boolean", "bool", "binary"
 * 4. Common boolean naming patterns + value is exactly 0 or 1
 */
function isBinaryFactorNode(node: GraphNode): boolean {
  const range = (node as any).state_space?.range;
  const value = node.observed_state?.value;

  // Signal 1: Explicit range [0,1]
  if (range && range.min === 0 && range.max === 1) {
    return true;
  }

  const label = (node.label ?? '').toLowerCase();

  // Signal 2: Label contains explicit binary markers
  if (label.includes('(0/1)') || label.includes('yes/no') || label.includes('true/false')) {
    return true;
  }

  // Signal 3: Unit suggests boolean
  const unit = (node.observed_state?.unit ?? '').toLowerCase();
  if (unit === 'boolean' || unit === 'bool' || unit === 'binary') {
    return true;
  }

  // Signal 4: Common boolean naming patterns + value is exactly 0 or 1
  // Only applies when no range is specified and value suggests binary
  if ((value === 0 || value === 1) && !range) {
    const id = node.id.toLowerCase();
    const booleanPrefixes = ['is_', 'has_', 'can_', 'should_', 'will_', 'was_', 'did_'];
    const booleanSuffixes = ['_flag', '_enabled', '_active', '_hired', '_present', '_available'];

    if (booleanPrefixes.some((p) => id.startsWith(p))) return true;
    if (booleanSuffixes.some((s) => id.endsWith(s))) return true;
  }

  return false;
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
