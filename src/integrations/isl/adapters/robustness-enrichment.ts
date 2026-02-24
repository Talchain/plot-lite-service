/**
 * Robustness Data Enrichment
 *
 * Enriches ISL robustness response with human-readable labels from the graph.
 * Used to prepare data for CEE /review synthesis.
 */

import type { EngineGraphV3, OptionV3 } from '../../../types/engine-v3.js';
import type {
  EnrichedFragileEdge,
  EnrichedRobustEdge,
  EnrichedFactorSensitivity,
  RobustnessDataForCee,
} from '../types/plot-types.js';
import type { ISLFactorSensitivityItem } from '../types/isl-types.js';

// =============================================================================
// Edge ID Parsing Helpers
// =============================================================================

/**
 * Parse the source node ID from an edge ID.
 * Supports both "->" and "::" separators.
 *
 * @example parseEdgeFrom("fac_price->goal_revenue") // "fac_price"
 * @example parseEdgeFrom("fac_price::goal_revenue") // "fac_price"
 */
export function parseEdgeFrom(edgeId: string): string {
  if (edgeId.includes('->')) {
    return edgeId.split('->')[0];
  }
  if (edgeId.includes('::')) {
    return edgeId.split('::')[0];
  }
  // Fallback: return as-is (might be just an ID)
  return edgeId;
}

/**
 * Parse the target node ID from an edge ID.
 * Supports both "->" and "::" separators.
 *
 * @example parseEdgeTo("fac_price->goal_revenue") // "goal_revenue"
 * @example parseEdgeTo("fac_price::goal_revenue") // "goal_revenue"
 */
export function parseEdgeTo(edgeId: string): string {
  if (edgeId.includes('->')) {
    return edgeId.split('->')[1] ?? edgeId;
  }
  if (edgeId.includes('::')) {
    return edgeId.split('::')[1] ?? edgeId;
  }
  // Fallback: return as-is
  return edgeId;
}

// =============================================================================
// Label Lookup Helpers
// =============================================================================

/**
 * Get the human-readable label for a node.
 * Falls back to node ID if not found.
 */
export function getNodeLabel(graph: EngineGraphV3, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return node?.label ?? nodeId;
}

/**
 * Get the human-readable label for an option.
 * Falls back to option ID if not found.
 */
export function getOptionLabel(options: OptionV3[], optionId: string): string {
  const option = options.find((o) => o.id === optionId);
  return option?.label ?? optionId;
}

// =============================================================================
// ISL Response Types (raw fragile edge formats)
// =============================================================================

/**
 * ISL fragile edge - can be either a string edge ID or structured object.
 */
export type ISLFragileEdge = string | {
  edge_id: string;
  from_id?: string;
  to_id?: string;
  alternative_winner_id?: string;
  switch_probability?: number;
  marginal_switch_probability?: number;
};

/**
 * ISL factor sensitivity item from response.
 * Re-exported from isl-types.ts for backward compatibility.
 *
 * @deprecated Import from '../types/isl-types.js' instead.
 */
export type { ISLFactorSensitivityItem };

// =============================================================================
// Enrichment Functions
// =============================================================================

/**
 * Enrich a single fragile edge with labels from the graph.
 */
export function enrichFragileEdge(
  edge: ISLFragileEdge,
  graph: EngineGraphV3,
  options: OptionV3[]
): EnrichedFragileEdge {
  // Handle both string and object formats
  if (typeof edge === 'string') {
    const fromId = parseEdgeFrom(edge);
    const toId = parseEdgeTo(edge);
    return {
      edge_id: edge,
      from_id: fromId,
      to_id: toId,
      from_label: getNodeLabel(graph, fromId),
      to_label: getNodeLabel(graph, toId),
    };
  }

  // Structured format with additional fields
  const fromId = edge.from_id ?? parseEdgeFrom(edge.edge_id);
  const toId = edge.to_id ?? parseEdgeTo(edge.edge_id);

  return {
    edge_id: edge.edge_id,
    from_id: fromId,
    to_id: toId,
    from_label: getNodeLabel(graph, fromId),
    to_label: getNodeLabel(graph, toId),
    alternative_winner_id: edge.alternative_winner_id,
    alternative_winner_label: edge.alternative_winner_id
      ? getOptionLabel(options, edge.alternative_winner_id)
      : undefined,
    switch_probability: edge.switch_probability,
    marginal_switch_probability: edge.marginal_switch_probability,
  };
}

/**
 * Enrich a robust edge with labels from the graph.
 */
export function enrichRobustEdge(
  edgeId: string,
  graph: EngineGraphV3
): EnrichedRobustEdge {
  const fromId = parseEdgeFrom(edgeId);
  const toId = parseEdgeTo(edgeId);

  return {
    edge_id: edgeId,
    from_label: getNodeLabel(graph, fromId),
    to_label: getNodeLabel(graph, toId),
  };
}

/**
 * Enrich factor sensitivity with labels from the graph.
 *
 * Handles both canonical (sensitivity_score) and legacy (sensitivity) fields
 * from ISL response. Defaults to 0 when neither is present because the
 * output type (EnrichedFactorSensitivity) requires a numeric sensitivity
 * value for CEE consumption. This differs from V2 run transform which
 * preserves undefined for UI-facing responses.
 */
export function enrichFactorSensitivity(
  factor: ISLFactorSensitivityItem,
  graph: EngineGraphV3
): EnrichedFactorSensitivity {
  // Schema v2.6 canonical field is 'sensitivity_score'; legacy used 'sensitivity'
  // Support both for backward compatibility, defaulting to 0 if neither present
  const sensitivityValue = factor.sensitivity_score ?? factor.sensitivity ?? 0;

  return {
    factor_id: factor.node_id,
    factor_label: getNodeLabel(graph, factor.node_id),
    sensitivity: sensitivityValue,
    value_of_information: factor.value_of_information,
    direction: factor.direction,
  };
}

/**
 * Build the full robustness data payload for CEE from ISL response.
 *
 * @param islRobustness - Raw robustness object from ISL response
 * @param islFactorSensitivity - Factor sensitivity array from ISL response
 * @param recommendedOptionId - Recommended option ID from ISL
 * @param graph - The causal graph with node labels
 * @param options - The options with labels
 * @returns Enriched robustness data for CEE, or null if no robustness data
 */
export function buildRobustnessDataForCee(
  islRobustness: {
    recommendation_stability?: number;
    fragile_edges?: ISLFragileEdge[];
    robust_edges?: string[];
  } | undefined,
  islFactorSensitivity: ISLFactorSensitivityItem[] | undefined,
  recommendedOptionId: string | undefined,
  graph: EngineGraphV3,
  options: OptionV3[]
): RobustnessDataForCee | null {
  // Check if there's any meaningful robustness data
  const hasFragileEdges = (islRobustness?.fragile_edges?.length ?? 0) > 0;
  const hasRobustEdges = (islRobustness?.robust_edges?.length ?? 0) > 0;
  const hasRecommendationStability = islRobustness?.recommendation_stability !== undefined;
  const hasFactorSensitivity = (islFactorSensitivity?.length ?? 0) > 0;

  // Return null if no meaningful data
  if (!hasFragileEdges && !hasRobustEdges && !hasRecommendationStability && !hasFactorSensitivity) {
    return null;
  }

  const fragileEdges = (islRobustness?.fragile_edges ?? []).map((edge) =>
    enrichFragileEdge(edge, graph, options)
  );

  const robustEdges = (islRobustness?.robust_edges ?? []).map((edgeId) =>
    enrichRobustEdge(edgeId, graph)
  );

  const factorSensitivity = islFactorSensitivity?.map((factor) =>
    enrichFactorSensitivity(factor, graph)
  );

  return {
    recommendation_stability: islRobustness?.recommendation_stability,
    recommended_option: recommendedOptionId
      ? {
          id: recommendedOptionId,
          label: getOptionLabel(options, recommendedOptionId),
        }
      : undefined,
    fragile_edges: fragileEdges,
    robust_edges: robustEdges,
    factor_sensitivity: factorSensitivity,
  };
}
