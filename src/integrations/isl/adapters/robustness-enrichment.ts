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
import { sanitiseIslVoi } from '../../../lib/evpi-emission.js';
import { finiteNum } from '../../../util/numeric.js';
import { sortByFragility } from './robustness-analysis.js';

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
 * from ISL response.
 *
 * ABSENT SENSITIVITY IS OMITTED, NEVER ZERO (ROADMAP 1.240, sibling 1).
 * This used to end `?? 0`, justified by "the output type requires a numeric
 * sensitivity value for CEE consumption". That is the fabricate-to-keep-the-
 * shape move the standing ruling forbids: a factor ISL said nothing about was
 * relabelled as a factor ISL had measured to have ZERO influence on the
 * decision — the strongest possible negative claim, manufactured from silence.
 * The file's own docstring conceded the divergence ("differs from V2 run
 * transform which preserves undefined for UI-facing responses"): the honest
 * shape already existed on one channel and the fabricated one on the other.
 *
 * The type requirement was the tail wagging the dog, so the TYPE moved:
 * `EnrichedFactorSensitivity.sensitivity` is now optional and this builder
 * omits it. `finiteNum` (not `!= null`) is the guard, so NaN/±Infinity are
 * treated as unmeasured too — the same admission rule the sibling ISL surfaces
 * already apply. A genuine measured `0` still passes through unchanged.
 */
export function enrichFactorSensitivity(
  factor: ISLFactorSensitivityItem,
  graph: EngineGraphV3
): EnrichedFactorSensitivity {
  // Schema v2.6 canonical field is 'sensitivity_score'; legacy used 'sensitivity'.
  // `??` already handles null correctly; what was wrong was the final `?? 0`.
  const sensitivityValue = finiteNum(factor.sensitivity_score ?? factor.sensitivity);

  return {
    factor_id: factor.node_id,
    factor_label: getNodeLabel(graph, factor.node_id),
    ...(sensitivityValue !== undefined && { sensitivity: sensitivityValue }),
    // Forward-safe internal hardening: apply the non-negative VOI contract
    // (Howard 1966) on this enrichment builder for consistency with the three
    // sibling surfaces that already sanitise ISL VOI — `mapIslFactorEntry`
    // (src/routes/v2/run.ts:590), `adaptFactorSensitivityResponse`
    // (./factor-sensitivity.ts:49), and `adaptRobustnessAnalysis`
    // (./robustness-analysis.ts:330). ISL emits VOI via a Monte Carlo estimator
    // that can drift slightly negative from sampling noise; `sanitiseIslVoi`
    // maps negative/non-finite values to `undefined` (absence means "no
    // measurable value of information", not zero).
    //
    // NOTE: this field is NOT currently consumed by any outbound CEE request —
    // `buildCeeReviewRequest` reads `RobustnessDataForCee` only via
    // `fragile_edges`, and `CeeReviewRequest` carries no VOI field. The guard
    // keeps the builder result contract-compliant should VOI ever be wired into
    // a CEE payload; it changes no CEE-visible data today.
    value_of_information: sanitiseIslVoi(factor.value_of_information),
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
  // Check if there's any meaningful robustness data.
  // recommendation_stability no longer counts as meaningful data and is no
  // longer forwarded (lane PLoT-H item B, 2026-07-07): ISL derives it as
  // option_wins[winner]/n_samples — the leader's win_probability relabelled,
  // zero independent information (verified byte-identical in live tests
  // 0.59025 / 0.8541875 and in tests/fixtures/isl-v2-live-20260706). Omission
  // is honest absence; consumers must not print it as a distinct "stability".
  const hasFragileEdges = (islRobustness?.fragile_edges?.length ?? 0) > 0;
  const hasRobustEdges = (islRobustness?.robust_edges?.length ?? 0) > 0;
  const hasFactorSensitivity = (islFactorSensitivity?.length ?? 0) > 0;

  // Return null if no meaningful data
  if (!hasFragileEdges && !hasRobustEdges && !hasFactorSensitivity) {
    return null;
  }

  // FRAGILITY ORDER, not ISL's wire order.
  //
  // ISL does not emit `fragile_edges` sorted by fragility — live on staging
  // build 1dd45b6 the array arrived as switch_probability
  // [0.075, 0.281, 0.375, 0.487, 0.569, 0.61, 0.307], so `[0]` was the LEAST
  // fragile of seven. The /v2/run RESPONSE path has sorted since then, inside
  // normalizeFragileEdges, but this CEE-facing builder never called it: one
  // request emitted fragility order to the UI and ISL's arbitrary order to
  // CEE. CEE reads position [0] (`decompose.ts` fragileEdges[0] ->
  // stabilityHint.top_fragile_edge), so the unsorted copy NAMED THE WRONG EDGE
  // as the one most likely to flip the decision.
  //
  // Sorted before enrichment, on a copy — never mutate ISL's array in place,
  // because the caller may still read it.
  const fragileEdges = sortByFragility([...(islRobustness?.fragile_edges ?? [])] as Array<
    ISLFragileEdge & { switch_probability?: number | null }
  >).map((edge) => enrichFragileEdge(edge, graph, options));

  const robustEdges = (islRobustness?.robust_edges ?? []).map((edgeId) =>
    enrichRobustEdge(edgeId, graph)
  );

  const factorSensitivity = islFactorSensitivity?.map((factor) =>
    enrichFactorSensitivity(factor, graph)
  );

  return {
    // recommendation_stability deliberately omitted — see item B note above.
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
