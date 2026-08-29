/**
 * Evidence Priority Card — Review Pass module
 *
 * Computes a ranked list of factors most likely to change the decision
 * if better evidence were gathered.
 *
 * Score = |elasticity| * (1 - confidence)
 *   where confidence is the unified factor confidence (pre-computed in factor_sensitivity
 *   pipeline via computeUnifiedConfidence). Falls back to inline computation when
 *   pre-computed confidence is not available.
 *
 * Suppression: if max(score) across ALL candidates < EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD,
 * the entire card is suppressed. Otherwise, top 3 items by score are included.
 */

import type { ProposalCardV1, PriorityBand, CardProvenance } from './types.js';
import { lookupBand } from './types.js';
import { finiteNum } from '../util/numeric.js';

// =============================================================================
// Types
// =============================================================================

export interface FactorInput {
  factor_id: string;
  factor_label: string;
  elasticity: number;
  attribution_stability?: string; // 'high' | 'moderate' | 'low' | 'negligible'
  incoming_edges?: Array<{ exists_probability: number }>;
  /** Pre-computed unified confidence. When present, used directly instead of recomputing. */
  confidence?: number;
}

export interface EvidencePriorityItem {
  /** Node ID in graph (same as factor_id). @source factor_sensitivity[].factor_id */
  node_id: string;
  factor_id: string;
  factor_label: string;
  /** Position in abs(elasticity) ranking (1-indexed). @source factor_sensitivity sorted by abs(elasticity) desc */
  sensitivity_rank: number;
  /** abs(elasticity). @source factor_sensitivity[].elasticity */
  sensitivity_value: number;
  /** 0–1, computed per confidence formula. @source 0.5 × attribution_stability_band_score + 0.5 × mean(exists_prob) */
  confidence_normalised: number;
  /** sensitivity_value × (1 - confidence_normalised). @source computed */
  score: number;
  /** Deterministic template based on confidence band. @source computed */
  suggested_evidence: string;
  /** Raw elasticity (signed). @source factor_sensitivity[].elasticity */
  elasticity: number;
}

export interface EvidencePriorityCard extends ProposalCardV1 {
  card_type: 'evidence_priority';
  items: EvidencePriorityItem[];
}

/**
 * The subset of a published `factor_sensitivity[]` row this card can read.
 * Mirrors the OPTIONALITY of `FactorSensitivityResultV3` deliberately:
 * `elasticity` and `sensitivity_score` are BOTH optional there because the
 * producer omits what it did not measure (`run.ts` → `finiteNum(f.elasticity)`).
 */
export interface EvidencePriorityFactorRow {
  factor_id: string;
  factor_label?: string | null;
  elasticity?: number;
  sensitivity_score?: number;
  confidence?: number;
  attribution_stability?: string;
}

/**
 * Map published `factor_sensitivity[]` rows onto this card's `FactorInput`
 * shape. THE one construction site — `/v2/run` calls this rather than
 * open-coding the mapping, so the rule below cannot drift away from the route
 * (a hand-written copy in `tests/lane-a1b-elasticity-suppression.test.ts` had
 * already drifted from the route's own version by one `??` limb).
 *
 * ── OMIT, NEVER SUBSTITUTE ─────────────────────────────────────────────────
 * `elasticity` is this card's RANKING KEY: `buildEvidencePriorityCard` orders
 * candidates by `abs(elasticity)` and scores them `abs(elasticity) × (1 −
 * confidence)`. A row whose elasticity was not measured therefore cannot be
 * ranked, and is DROPPED — the ranking excludes what it cannot rank. Two
 * substitutions previously stood on this path (`run.ts:3971`,
 * `elasticity: fs.elasticity ?? fs.sensitivity_score ?? 0`) and are
 * deliberately absent:
 *
 *   · `?? fs.sensitivity_score` — a CROSS-QUANTITY alias. These are different
 *     quantities; on the 2026-07-07 staging capture `fac_hiring_cost` carried
 *     `elasticity: +0.497` against `sensitivity_score: -0.175` — opposite sign,
 *     2.84× apart, same response. `src/facts/mapper.ts` removed exactly this
 *     alias on the fact_objects path (FAMILY-4 SLICE 0, 2026-07-27); this is
 *     the same alias surviving on the review-cards path. If the substitution is
 *     ever wanted it must be DISCLOSED BY NAME on the wire, never aliased here.
 *   · `?? 0` — "zero elasticity" is a measurement, not "not measured". It does
 *     not merely mis-state the row; it RANKS it, and `?? ` does not catch a
 *     non-finite value either, so a NaN elasticity propagated into
 *     `Math.abs()` and defeated the card's own suppression threshold.
 *
 * ── A MEASURED ZERO IS NOT AN ABSENCE ──────────────────────────────────────
 * `finiteNum` tests FINITENESS, never truthiness, so `elasticity === 0` — a
 * real result, and the value the producer publishes for an option-pinned lever
 * — passes through and is ranked at 0. Turning a real measurement into an
 * omission is the mirror defect and would be just as wrong. See
 * `src/routes/v2/numeric-egress-guards.ts:81-83`.
 */
export function toEvidencePriorityFactorInputs(
  factors: ReadonlyArray<EvidencePriorityFactorRow>,
  edges?: ReadonlyArray<{ to: string; exists_probability: number }>,
): FactorInput[] {
  return factors.flatMap((fs) => {
    const elasticity = finiteNum(fs.elasticity);
    if (elasticity === undefined) return [];
    return [{
      factor_id: fs.factor_id,
      factor_label: fs.factor_label ?? fs.factor_id,
      elasticity,
      confidence: fs.confidence ?? undefined,
      attribution_stability: fs.attribution_stability ?? undefined,
      incoming_edges: edges
        ? edges.filter((e) => e.to === fs.factor_id).map((e) => ({ exists_probability: e.exists_probability }))
        : undefined,
    }];
  });
}

// =============================================================================
// Constants
// =============================================================================

export const EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD = 0.05;

/**
 * Attribution-stability band scores used by the unified confidence formula.
 *
 * v2 (formula_version `plot_unified_v2`, audit row A1-SECONDARY): `low` is
 * lifted from 0.0 to 0.25 so that root factors with no incoming edges no
 * longer collapse to the same numeric output as `negligible`. Geometric
 * halving across bands (1.0 → 0.5 → 0.25 → 0.0) preserves monotonicity and
 * keeps `negligible` at 0.0 (no information loss). High and moderate are
 * unchanged. See truth-table row A1-SECONDARY for evidence.
 *
 * v3 (formula_version `plot_unified_v3`): the unified formula prefers ISL's
 * continuous bootstrap confidence to the band collapse; this table is used
 * only as the v2 fallback when ISL's continuous confidence is absent or
 * out-of-range. Sampling_stability progressive disclosure still derives
 * from this table on every entry where ISL emits `attribution_stability`,
 * regardless of which formula version produced the public `confidence`.
 *
 * Coefficients are still operational defaults pending pilot calibration
 * (Neil gate 1, Jinghui calibration brief).
 */
export const ATTRIBUTION_STABILITY_BAND_SCORES: Record<string, number> = {
  high: 1.0,
  moderate: 0.5,
  low: 0.25,
  negligible: 0.0,
};

const DEFAULT_BAND_SCORE = 0.5;
const MAX_ITEMS = 3;

// =============================================================================
// Computation
// =============================================================================

/**
 * Compute normalised confidence for a factor.
 *
 * confidence_normalised = 0.5 * band_score + 0.5 * mean(exists_probability)
 *
 * Clamped to [0, 1].
 */
export function computeConfidenceNormalised(
  attributionStability: string | undefined,
  incomingEdges: Array<{ exists_probability: number }> | undefined
): number {
  const bandScore = attributionStability !== undefined
    ? (ATTRIBUTION_STABILITY_BAND_SCORES[attributionStability] ?? DEFAULT_BAND_SCORE)
    : DEFAULT_BAND_SCORE;

  let meanExistsProb = 0.5; // default when no edges
  if (incomingEdges && incomingEdges.length > 0) {
    const sum = incomingEdges.reduce((acc, e) => acc + e.exists_probability, 0);
    meanExistsProb = sum / incomingEdges.length;
  }

  const raw = 0.5 * bandScore + 0.5 * meanExistsProb;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Generate suggested evidence text based on confidence level.
 * Items with confidence >= 0.7 are suppressed (not worth investigating).
 *
 * Audit A1-SECONDARY threshold-impact note (`plot_unified_v2`): the band
 * table now distinguishes `low` (0.25) from `negligible` (0.0). For root
 * factors with no incoming edges, this means:
 *   pre-v2:  low / negligible both → confidence 0.25 → "low confidence" copy
 *   post-v2: low → 0.375 (still "low confidence", < 0.4)
 *            negligible → 0.25 (still "low confidence", < 0.4)
 * No factor crosses the 0.4 / 0.7 threshold solely from the v2 band-table
 * change for any input where the previous output was 0.25. The text-classifier
 * bucket is unchanged for those cases. Higher-edge-probability inputs paired
 * with `low` may shift "low" → "medium" copy at edge_mean ~ 0.55 (post-v2:
 * 0.5 × 0.25 + 0.5 × 0.55 = 0.4) — this is the intended consequence of
 * distinguishing the two bands and is documented in the brief's final report.
 */
function suggestedEvidenceText(factorLabel: string, confidence: number): string | null {
  if (confidence >= 0.7) return null; // suppress — high confidence
  if (confidence < 0.4) {
    return `Gather evidence on how ${factorLabel} affects the goal — this factor is highly sensitive but your confidence in its strength is low.`;
  }
  return `Gather evidence on how ${factorLabel} affects the goal — this factor is highly sensitive but your confidence in its strength is medium.`;
}

/**
 * Build an EvidencePriorityCard from factor inputs.
 *
 * Suppression:
 * - Per-item: items with confidence_normalised >= 0.7 are excluded (not worth investigating).
 * - Card-level: if max(score) across ALL candidates < threshold, returns null.
 * - Card-level: if all top-3 candidates have confidence >= 0.7, returns null.
 *
 * Returns top 3 items by score after per-item suppression.
 */
export function buildEvidencePriorityCard(
  factors: FactorInput[]
): EvidencePriorityCard | null {
  // Build sensitivity ranking (all factors sorted by abs(elasticity) desc)
  const sensitivityRanked = [...factors].sort((a, b) => {
    const diff = Math.abs(b.elasticity) - Math.abs(a.elasticity);
    if (diff !== 0) return diff;
    return a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0;
  });
  const sensitivityRankMap = new Map<string, number>();
  sensitivityRanked.forEach((f, i) => sensitivityRankMap.set(f.factor_id, i + 1));

  // Compute scores for ALL candidates
  // Use pre-computed unified confidence when available (from factor_sensitivity pipeline),
  // falling back to inline computation for backwards compatibility.
  const allItems: EvidencePriorityItem[] = factors.map(f => {
    const confidence = f.confidence != null
      ? Math.max(0, Math.min(1, f.confidence))
      : computeConfidenceNormalised(f.attribution_stability, f.incoming_edges);
    const sensitivityValue = Math.abs(f.elasticity);
    const suggested = suggestedEvidenceText(f.factor_label, confidence);
    return {
      node_id: f.factor_id,
      factor_id: f.factor_id,
      factor_label: f.factor_label,
      sensitivity_rank: sensitivityRankMap.get(f.factor_id) ?? 0,
      sensitivity_value: sensitivityValue,
      confidence_normalised: confidence,
      score: sensitivityValue * (1 - confidence),
      suggested_evidence: suggested ?? '',
      elasticity: f.elasticity,
    };
  });

  // Suppress entire card if max score < threshold
  const maxScore = allItems.reduce((max, item) => Math.max(max, item.score), 0);
  if (maxScore < EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD) return null;

  // Sort by score descending, then factor_id ascending for determinism
  allItems.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0;
  });

  // Per-item suppression: exclude items with confidence >= 0.7 (not worth investigating)
  const eligible = allItems.filter(i => i.confidence_normalised < 0.7);

  // Card suppression: if all candidates are high-confidence, suppress entire card
  if (eligible.length === 0) return null;

  const topItems = eligible.slice(0, MAX_ITEMS);
  const topFactorLabels = topItems.map(i => i.factor_label).join(', ');

  const priority = 2;
  const priorityBand: PriorityBand = lookupBand(priority);
  const provenance: CardProvenance = {
    source: 'isl',
    origin_id: 'evidence_priority',
  };

  return {
    card_id: `ep_${topItems.map(i => i.factor_id).join('_')}`,
    card_type: 'evidence_priority',
    review_phase: 'post_analysis',
    what: `Gathering better evidence on ${topFactorLabels} could change the recommendation.`,
    why: `These factors have high sensitivity but low confidence — better data would most improve decision quality.`,
    // NOTE (namespace asymmetry): these ref IDs are constructed placeholders
    // (`sensitivity_{factor_id}`), not fact_id values from assembleFactObjects().
    // /v2/run DOES assemble and emit `fact_objects` when ENABLE_FACTS_ASSEMBLY is
    // on — default ON under NODE_ENV=test and on any Render service whose name
    // contains 'staging', OFF in production unless set explicitly. Read the rule
    // at src/config/flags.ts rather than trusting this line.
    // The two ID spaces cannot collide: a real fact_id is a 16-char SHA-256 hex
    // digest (generateFactId, src/facts/hash.ts) and `sensitivity_` is not hex,
    // so these placeholders stay disjoint from the assembled namespace rather
    // than shadowing it.
    // Citation consequence: a [fact_id] citation in an explain_results
    // CommentaryBlock resolves against neither these refs NOR our emitted
    // fact_objects — CEE assembles no FactObjects of its own and skip-lists
    // `fact_objects` in its analysis→LLM projection, so no fact_id from this
    // response reaches the model that writes the commentary (verify in
    // olumi-assistants-service: src/orchestrator-v5/context/enrichment-manifest.ts).
    // Treat these refs as provenance breadcrumbs for `items`, not as resolvable
    // citations.
    supporting_refs: topItems.map(i => ({
      kind: 'fact' as const,
      id: `sensitivity_${i.factor_id}`,
      role: 'derived_from' as const,
    })),
    priority,
    priority_band: priorityBand,
    suggested_action: 'add_evidence',
    provenance,
    items: topItems,
  };
}
