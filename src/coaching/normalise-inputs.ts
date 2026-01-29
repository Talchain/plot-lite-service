/**
 * Input Normalisation for M1 Coaching
 *
 * Maps ISL response format to coaching-friendly structures with:
 * - Human-readable labels from graph nodes
 * - Fragile edge display formatting
 * - Safe defaults for missing fields
 */

import type {
  CoachingInputs,
  NormalisedFactorSensitivity,
  NormalisedFragileEdge,
  NormalisedOption,
  NormalisedRobustness,
} from './types.js';
import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';

/**
 * Normalise ISL response data for coaching consumption.
 *
 * Handles missing fields, builds label lookups, and formats display strings.
 */
export function normaliseCoachingInputs(
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any
): CoachingInputs {
  // Build node label lookup from graph
  const nodeLabelMap = new Map<string, string>(
    graph.nodes.map((n) => [n.id, n.label])
  );

  // Normalise factor sensitivity
  const factorSensitivity: NormalisedFactorSensitivity[] =
    (islResult.factor_sensitivity ?? []).map((f: any) => ({
      node_id: f.node_id,
      label: nodeLabelMap.get(f.node_id) ?? f.node_id,
      elasticity: f.elasticity,
      importance_rank: f.importance_rank ?? 999,
      confidence: f.confidence,
      direction: f.direction,
      influence_score: f.influence_score,
      zero_reason: f.zero_reason,
    }));

  // Normalise fragile edges with human-readable labels
  // Sort by marginal switch probability descending (highest first) for reliable [0] access
  const fragileEdges: NormalisedFragileEdge[] = (
    islResult.robustness?.fragile_edges ?? []
  )
    .map((edge: any) => {
      // Parse edge_id (format: "from->to", "from::to", "from-to", or "from→to")
      const fromId = edge.from_id ?? edge.edge_id?.split(/->|::|→|-/)[0] ?? 'unknown';
      const toId = edge.to_id ?? edge.edge_id?.split(/->|::|→|-/)[1] ?? 'unknown';
      const fromLabel = nodeLabelMap.get(fromId) ?? fromId;
      const toLabel = nodeLabelMap.get(toId) ?? toId;

      return {
        edgeId: edge.edge_id ?? `${fromId}::${toId}`,
        fromId,
        toId,
        fromLabel,
        toLabel,
        displayLabel: `${fromLabel} → ${toLabel}`,
        marginalSwitchProb: edge.marginal_switch_probability ?? 0,
        altWinnerId: edge.alternative_winner_id ?? null,
        altWinnerLabel: edge.alternative_winner_id
          ? options.find((o) => o.id === edge.alternative_winner_id)?.label ?? edge.alternative_winner_id
          : null,
      };
    })
    .sort((a: NormalisedFragileEdge, b: NormalisedFragileEdge) => b.marginalSwitchProb - a.marginalSwitchProb);

  // Normalise options with ISL outcome data
  // Sort by win probability descending (highest first) for reliable [0] access
  const normalisedOptions: NormalisedOption[] = (islResult.options ?? [])
    .map((islOpt: any) => {
      const matchingOption = options.find((o) => o.id === islOpt.id);
      return {
        id: islOpt.id,
        label: matchingOption?.label ?? islOpt.label ?? islOpt.id,
        winProbability: islOpt.win_probability ?? 0,
        outcomeMean: islOpt.outcome?.mean ?? 0,
        outcomeP10: islOpt.outcome?.p10,
        outcomeP90: islOpt.outcome?.p90,
      };
    })
    .sort((a: NormalisedOption, b: NormalisedOption) => b.winProbability - a.winProbability);

  // Normalise robustness
  const robustness: NormalisedRobustness = {
    level: islResult.robustness?.level,
    recommendationStability: islResult.robustness?.recommendation_stability,
    isRobust: islResult.robustness?.is_robust,
  };

  return {
    factorSensitivity,
    fragileEdges,
    options: normalisedOptions,
    graph,
    robustness,
  };
}
