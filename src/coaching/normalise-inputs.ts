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
import type {
  EngineGraphV3,
  FactorSensitivityResultV3,
  OptionV3,
} from '../types/engine-v3.js';
import { interventionTargetIdsFromOptions } from '../lib/intervention-override.js';

/**
 * Normalise ISL response data for coaching consumption.
 *
 * Handles missing fields, builds label lookups, and formats display strings.
 *
 * @param enrichedFactorSensitivity When provided, factor signals are normalised
 *   from the public/enriched `factor_sensitivity[]` array (graph-merged
 *   influence, PLoT-recomputed confidence). When omitted, falls back to raw
 *   `islResult.factor_sensitivity`. Production callers should always pass the
 *   enriched array to keep coaching provenance aligned with the public
 *   payload.
 *
 *   Fallback compatibility note: the legacy path preserves the *shape* of
 *   raw-ISL coaching inputs (so unit tests that build `CoachingInputs` directly
 *   from a mocked ISL response continue to type-check and run). Numeric
 *   *semantics* may differ from pre-refactor behaviour for inputs that supply
 *   both `elasticity` and `influence_score` with different values, because the
 *   `computeNormalisedImpact` helper now globally prefers `influence_score`
 *   (canonical PLoT signal) over `elasticity` (raw ISL). This is intentional
 *   and matches the public `factor_sensitivity[]` contract.
 */
export function normaliseCoachingInputs(
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any,
  enrichedFactorSensitivity?: FactorSensitivityResultV3[]
): CoachingInputs {
  // Build node label lookup from graph
  const nodeLabelMap = new Map<string, string>(
    graph.nodes.map((n) => [n.id, n.label])
  );

  const factorSensitivity: NormalisedFactorSensitivity[] = enrichedFactorSensitivity
    ? enrichedFactorSensitivity.map((f) => ({
        node_id: f.factor_id,
        label: nodeLabelMap.get(f.factor_id) ?? f.factor_label ?? f.factor_id,
        elasticity: f.elasticity,
        importance_rank: f.importance_rank ?? f.influence_rank ?? 999,
        confidence: f.confidence,
        direction:
          f.direction === 'positive' || f.direction === 'negative'
            ? f.direction
            : undefined,
        influence_score: f.influence_score ?? f.sensitivity_score,
        zero_reason: f.zero_reason,
      }))
    : (islResult.factor_sensitivity ?? []).map((f: any) => ({
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
  // Prefer switch_probability (UI field) with fallback to marginal_switch_probability
  // Sort by switch probability descending (highest first) for reliable [0] access
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
        // Prefer switch_probability (aligned with UI) over marginal_switch_probability
        switchProb: edge.switch_probability ?? edge.marginal_switch_probability ?? 0,
        altWinnerId: edge.alternative_winner_id ?? null,
        altWinnerLabel: edge.alternative_winner_id
          ? options.find((o) => o.id === edge.alternative_winner_id)?.label ?? edge.alternative_winner_id
          : null,
      };
    })
    .sort((a: NormalisedFragileEdge, b: NormalisedFragileEdge) => b.switchProb - a.switchProb);

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

  // Derive intervention-target factor IDs from option interventions.
  // These are decision levers the user controls — not background uncertainties
  // to "gather evidence on". `computeEvidenceGaps` excludes them from the
  // current "what to validate next" list. Source of truth is the request-side
  // `options[i].interventions` map, NOT raw ISL `zero_reason`, because ISL's
  // zero_reason is a downstream symptom rather than the canonical definition.
  // The derivation itself lives in the shared lever-identity leaf
  // (`src/lib/intervention-override.ts`) so coaching and the public
  // factor_sensitivity/EVPI egress share ONE union definition (D-U, ROADMAP 2.40).
  const interventionTargetIds = interventionTargetIdsFromOptions(options);

  return {
    factorSensitivity,
    fragileEdges,
    options: normalisedOptions,
    graph,
    robustness,
    interventionTargetIds,
  };
}

/**
 * Compute normalised impact scores for factors (0-1 scale).
 * Used by both evidence gaps and key drivers to ensure consistency.
 *
 * Provenance: prefer `influence_score` (canonical, graph-merged signal carried
 * on enriched FactorSensitivityResultV3 entries) over `elasticity` (raw ISL
 * value preserved on enriched ISL-only-append entries and on legacy raw-ISL
 * inputs). For graph-source enriched entries `influence_score === elasticity`
 * so the choice is moot; for ISL-only-append entries the two can differ and
 * influence_score is the right canonical signal to propagate into the public
 * `m1_coaching.evidence_gaps[].influence` field — matching the same provenance
 * promise the public `factor_sensitivity[].influence_score` carries.
 *
 * @param factors Factor sensitivity data
 * @returns Map of factor ID to normalised impact (0-1)
 */
export function computeNormalisedImpact(
  factors: NormalisedFactorSensitivity[]
): Map<string, number> {
  if (factors.length === 0) {
    return new Map();
  }

  const impactOf = (f: NormalisedFactorSensitivity): number =>
    Math.abs(f.influence_score ?? f.elasticity ?? 0);

  const maxImpact = Math.max(...factors.map(impactOf), 0.001);

  return new Map(factors.map((f) => [f.node_id, impactOf(f) / maxImpact]));
}
