/**
 * Confidence Badge - LOW / MEDIUM / HIGH with reason
 *
 * THE PUBLISHED SCORE DERIVES ONLY FROM GROUNDED FACTORS (2026-08-13).
 * ------------------------------------------------------------------
 * This badge previously carried a FOURTH factor, `calibration`, self-commented
 * `placeholder - no behavior change when false`, holding 150 of the 1000-point
 * weight budget. It was inert in the strict sense: `calibrated` was passed
 * `false` at every production call site — `src/routes/v1/run.ts`,
 * `src/routes/v1/self-check.ts`, `src/fixtures/demo-payloads.ts` — and omitted
 * entirely (so defaulted false) by `src/inference/model_of_inference.ts`. It
 * therefore resolved to 0.5 for every request the service could receive and
 * contributed a CONSTANT +75 raw points, i.e. +0.075 on the published 0–1
 * score, that no property of the graph could move.
 *
 * Two things were wrong with that, and they are different:
 *   - the `factors` breakdown NAMED a determinant that did not determine
 *     anything, telling a caller the engine had a calibration input when it
 *     had none;
 *   - the top of the documented 0–1 range was UNREACHABLE. A perfectly
 *     identified, in-linear-range, fully-sampled graph scored 0.93, because
 *     7.5% of the scale was permanently locked in the placeholder.
 *
 * The term is dropped rather than implemented here. Real calibration already
 * has an owner — `src/trust/confidence-calibrated.ts`, whose `calibration`
 * comes from an actual `mask_diversity` measurement — and adding a second,
 * differently-grounded calibration concept under the same name is the twin
 * defect this estate keeps paying for. One authority per concept.
 *
 * RENORMALISATION, AND WHY THE THRESHOLDS MOVED WITH IT.
 * The three surviving weights (350 / 250 / 250, summing to 850) are rescaled by
 * 1000/850 to 412 / 294 / 294, which sums to exactly 1000 and preserves their
 * relative sizes (350:250 = 1.4000; 412:294 = 1.4014, the difference being
 * integer rounding). Scores are otherwise unchanged in kind.
 *
 * The level thresholds are rescaled by the SAME derivation rather than left at
 * 750/500, because leaving them would have silently re-tuned the level
 * boundaries — a user-visible verdict change smuggled in on the back of a
 * fabrication removal. The old test `(real + 75) >= T` is equivalent to
 * `real >= T - 75`, and the new score is `real * 1000/850`, so the equivalent
 * threshold is `(T - 75) * 1000/850`:
 *
 *     HIGH:   (750 - 75) * 1000/850 = 794.1  ->  794
 *     MEDIUM: (500 - 75) * 1000/850 = 500.0  ->  500
 *
 * Verified by exhaustive enumeration of the complete reachable input domain
 * (2 identifiability × 2 linear-range × 3 k-coverage bands = 12 cells): ZERO
 * cells change level, score deltas run from -0.02 to +0.07, and the full 0–1
 * range becomes attainable. The domain is closed and small, so that is a proof
 * over every reachable input rather than a sample. Pinned cell-by-cell in
 * tests/trust.confidence.grounded-factors.test.ts, which REDs if any level moves.
 */

import type { ConfidenceBadge, ConfidenceLevel, Graph } from './types.js';

export interface ConfidenceInputs {
  graph: Graph;
  identifiable: boolean;
  in_linear_range: boolean;
  k_samples?: number;
}

/**
 * Weight budget, in thousandths. Sums to exactly 1000 so the published 0–1
 * range is fully attainable; asserted by the grounded-factors suite.
 */
const WEIGHT_IDENTIFIABILITY = 412;
const WEIGHT_LINEARITY = 294;
const WEIGHT_K_COVERAGE = 294;

/**
 * Level thresholds on the 0–1000 raw scale (see the derivation above).
 *
 * EXPORTED so tests can derive the band boundaries instead of copying them.
 * A hardcoded numeric bound in a spec is a hand-maintained mirror: the previous
 * one (`expect(score).toBeLessThan(0.75)` in tests/trust-signals.test.ts) was
 * calibrated against the pre-renormalisation scale and silently encoded the
 * placeholder's constant offset, so it failed on a change that preserved the
 * very level it was checking.
 */
export const CONFIDENCE_THRESHOLDS = {
  /**
   * Raw score at or above which the badge reads HIGH.
   *
   * ⚠ 794 IS A ROUNDED BOUNDARY AND ONE CELL SITS EXACTLY ON IT. The derived
   * boundary is 794.1176; the golden cell (identifiable, in linear range,
   * k < 500) lands on raw exactly 794, so it reads HIGH here and would read
   * MEDIUM against the unrounded value. Rounding down is deliberate — it keeps
   * that cell's level identical to its pre-renormalisation verdict, which is
   * the whole point of rescaling the thresholds. Nothing about it is
   * self-evident from the number, so it is pinned twice: by the 12-cell table
   * in tests/trust.confidence.grounded-factors.test.ts and, independently and
   * through the real HTTP route, by contracts/snapshots/report.v1.example.json.
   */
  HIGH: 794,
  /** Raw score at or above which the badge reads MEDIUM. */
  MEDIUM: 500,
  /** Full scale; the weights sum to this, so the whole 0–1 range is attainable. */
  SCALE: 1000,
} as const;

const THRESHOLD_HIGH = CONFIDENCE_THRESHOLDS.HIGH;
const THRESHOLD_MEDIUM = CONFIDENCE_THRESHOLDS.MEDIUM;

/**
 * Calculate confidence score based on graph quality and coverage
 */
export function calculateConfidence(inputs: ConfidenceInputs): ConfidenceBadge {
  const {
    graph,
    identifiable,
    in_linear_range,
    k_samples = 1000,
  } = inputs;

  const node_count = graph.nodes.length;
  const edge_count = graph.edges.length;

  // Factor 1: Identifiability (0-1)
  const identifiability_score = identifiable ? 1.0 : 0.3;

  // Factor 2: Linearity distance (0-1)
  const linearity_score = in_linear_range ? 1.0 : 0.5;

  // Factor 3: K-coverage (0-1)
  // Good coverage: k >= 1000, Medium: 500-999, Low: < 500
  let k_coverage_score = 0.5;
  if (k_samples >= 1000) k_coverage_score = 1.0;
  else if (k_samples >= 500) k_coverage_score = 0.7;
  else k_coverage_score = 0.3;

  // Integer math for determinism. Weights sum to exactly 1000, so the whole
  // published 0-1 range is attainable and no share of the scale is pinned to a
  // value the request cannot influence.
  const ident_raw = Math.round(identifiability_score * 1000);
  const linear_raw = Math.round(linearity_score * 1000);
  const kcov_raw = Math.round(k_coverage_score * 1000);

  const overall_raw =
    Math.round(ident_raw * WEIGHT_IDENTIFIABILITY / 1000) +
    Math.round(linear_raw * WEIGHT_LINEARITY / 1000) +
    Math.round(kcov_raw * WEIGHT_K_COVERAGE / 1000);

  let level: ConfidenceLevel;
  let reason: string;

  if (overall_raw >= THRESHOLD_HIGH) {
    level = 'HIGH';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: true,
    });
  } else if (overall_raw >= THRESHOLD_MEDIUM) {
    level = 'MEDIUM';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: null,
    });
  } else {
    level = 'LOW';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: false,
    });
  }

  // Invariant: level must be uppercase only
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(level)) {
    throw new Error(`Invalid confidence.level: ${level}`);
  }

  return {
    level,
    reason,
    score: Math.round(overall_raw / 10) / 100, // Convert 0-1000 to 0.00-1.00
    factors: {
      identifiability: identifiability_score,
      linearity_distance: linearity_score,
      k_coverage: k_coverage_score,
    },
  };
}

interface ReasonInputs {
  identifiable: boolean;
  node_count: number;
  edge_count: number;
  in_linear_range: boolean;
  k_samples: number;
  positive: boolean | null; // true = HIGH, null = MEDIUM, false = LOW
}

function buildReason(inputs: ReasonInputs): string {
  const { identifiable, node_count, edge_count, in_linear_range, k_samples, positive } = inputs;

  if (positive === true) {
    return `Strong identifiability, ${node_count} nodes well-connected, within linear range, k=${k_samples}`;
  }

  if (positive === null) {
    const issues: string[] = [];
    if (!identifiable) issues.push('weak identifiability');
    if (!in_linear_range) issues.push('outside linear range');
    if (k_samples < 1000) issues.push(`limited samples (k=${k_samples})`);
    if (node_count < 6) issues.push(`sparse graph (${node_count} nodes)`);

    return issues.length > 0
      ? `Acceptable but ${issues.join(', ')}`
      : `${node_count} nodes, k=${k_samples}, identifiable`;
  }

  // LOW confidence
  const blockers: string[] = [];
  if (!identifiable) blockers.push('not identifiable');
  if (node_count < 4) blockers.push(`too few nodes (${node_count})`);
  if (edge_count < node_count - 1) blockers.push('disconnected graph');
  if (k_samples < 500) blockers.push(`insufficient samples (k=${k_samples})`);

  return blockers.length > 0
    ? `Low confidence: ${blockers.join(', ')}`
    : 'Limited evidence for robust inference';
}
