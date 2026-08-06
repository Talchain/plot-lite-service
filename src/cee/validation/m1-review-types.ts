/**
 * M1 Review Types
 *
 * Type definitions for M2 Decision Review Integration.
 * These types define what CEE returns (M1Review) and what PLoT sends (DecisionReviewRequest).
 *
 * NOTE: The CEE prompt file is the canonical source. These types are based on
 * the brief specification - adjust if the actual prompt differs.
 *
 * @see Brief: M2 Decision Review Integration
 */

import { z } from 'zod';
import { M1_REVIEW_LIMITS, type ReviewStatus, type ReviewSkipReason } from './m1-review-constants.js';
import type { MarginSensitivity } from '../../analysis/margin-sensitivity.js';

// =============================================================================
// M1Review — What CEE Returns
// =============================================================================

/**
 * Robustness explanation from CEE.
 * Summarizes model stability and risk factors.
 */
export interface RobustnessExplanation {
  /** Summary of the robustness assessment */
  summary: string;
  /** Primary risk to the recommendation */
  primary_risk: string;
  /** Factors contributing to stability (max 3) */
  stability_factors: string[];
  /** Factors contributing to fragility (max 3) */
  fragility_factors: string[];
}

/**
 * Evidence enhancement suggestion for a factor.
 */
export interface EvidenceEnhancement {
  /** Specific action to gather evidence */
  specific_action: string;
  /** Decision hygiene recommendation */
  decision_hygiene: string;
}

/**
 * Scenario context for a fragile edge.
 * Describes what happens if the edge changes.
 */
export interface ScenarioContext {
  /** Description of what triggers this scenario */
  trigger_description: string;
  /** Consequence description - must reference valid option label/ID */
  consequence: string;
}

/**
 * Bias finding from CEE.
 * Identifies potential cognitive biases in the decision model.
 */
export interface BiasFinding {
  /** Type of bias (e.g., SUNK_COST, DOMINANT_FACTOR) */
  type: string;
  /** Source of the bias finding */
  source: 'structural' | 'semantic';
  /** Description of the bias */
  description: string;
  /** Affected node_ids or edge_ids */
  affected_elements: string[];
  /** Required when source='structural' - links to model critique */
  linked_critique_code?: string;
  /** Required when source='semantic' - exact substring from brief */
  brief_evidence?: string;
  /**
   * DSK science citation — the claim id this finding is grounded in.
   *
   * ⚠ THIS FIELD WAS BEING DELETED IN TRANSIT UNTIL ROADMAP 2.404's MECHANISM
   * WAS FOUND. `BiasFindingSchema` below was a bare `z.object()`, which STRIPS
   * unknown keys silently, and PLoT parses CEE's review with it on the live
   * path (`decision-review-orchestrator.ts:220`). So the citation was produced
   * by CEE, HARD-ENFORCED there (`shape-check.ts:459` rejects the whole review
   * with 422 when the id is not in the loaded DSK bundle), and then discarded
   * one hop later before any user could see it — "we paid for the science and
   * never turned it on". Declared here so it survives, and so a consumer can
   * see it in the type.
   *
   * Present only when CEE's prompt carried a SCIENCE_CLAIMS section; the
   * producer's contract is "omit both fields everywhere" when it did not.
   */
  dsk_claim_id?: string;
  /**
   * Evidence strength copied verbatim from the DSK claim, and the licence for
   * the finding's phrasing band ("strong" claims may say "typically"/"research
   * shows"; "medium" must say "can"/"often"/"may").
   *
   * ⚠ TYPED AS `string`, DELIBERATELY, NOT AS AN ENUM. CEE's decision-review
   * seam only WARNS on a value outside ["strong","medium"]
   * (`shape-check.ts:467-471`) while the DSK bundle's own vocabulary is wider
   * — `"strong" | "medium" | "weak" | "mixed"` (`src/dsk/types.ts:35`,
   * `EVIDENCE_STRENGTHS`). A closed enum here would be a hand-maintained mirror
   * of another repo's vocabulary that HARD-REJECTS THE ENTIRE REVIEW the first
   * time that vocabulary grows — trading a dropped field for a dropped review.
   * Same reasoning as `FlipThresholdInputData.flip_reason` above.
   */
  evidence_strength?: string;
}

/**
 * Decision quality prompt.
 * A question to help improve decision quality.
 */
export interface DecisionQualityPrompt {
  /** The principle this prompt addresses */
  principle: string;
  /** Why this principle applies to this decision */
  applies_because: string;
  /** The question to ask (must end with ?) */
  question: string;
}

/**
 * Pre-mortem analysis.
 * Anticipates potential failure scenarios.
 */
export interface PreMortem {
  /** Description of the failure scenario */
  failure_scenario: string;
  /** Early warning signs to watch for */
  warning_signs: string[];
  /** Mitigation strategy */
  mitigation: string;
  /** IDs this is grounded in (fragile_edge or evidence_gap IDs) */
  grounded_in: string[];
  /** Optional trigger for review */
  review_trigger?: string;
}

/**
 * Flip threshold analysis.
 * Shows how much a factor would need to change to flip the recommendation.
 */
export interface FlipThreshold {
  /** Factor ID — copied exactly from the `flip_threshold_data` entry. */
  factor_id: string;
  /** Factor label for display — copied exactly. */
  factor_label: string;
  /**
   * The DISPLAY form of the factor's current value, as a string.
   *
   * ⚠ THIS IS THE RETURN SHAPE, NOT THE REQUEST SHAPE — ROADMAP 2.670. Do not
   * "restore" the numeric `current_value`/`flip_value` that used to sit here.
   * PLoT SENDS numbers ({@link FlipThresholdInputData}); CEE SENDS BACK display
   * strings, and modelling the two directions with one shape is precisely the
   * defect 2.670 records: a producer-conformant row failed `safeParseM1Review`
   * with three `invalid_type` "Required" issues, and the orchestrator discards
   * the ENTIRE review on a shape failure — so one mis-modelled sub-object killed
   * every other section of the review with it, on every run carrying a flip.
   *
   * The producer's contract (CEE `staging` 658cdff3,
   * `Prompts/canonical/decision_review.txt:411-423`) permits exactly two forms
   * and no third:
   *   1. The value carries a unit → quoted verbatim with the unit appended:
   *      "16000 GBP", "800 customers". No rounding, no separators, no "k"/"m".
   *   2. The value carries no unit and lies between 0 and 1 → probability-like,
   *      so the percentage form: "35%", never "0.35".
   * A bare decimal in either field is a raw probability and is not a legal
   * display form. `validateFlipThresholds` (validator Tier 7) enforces that the
   * NUMBER named here is the number PLoT sent, under whichever form applies.
   */
  current_display: string;
  /** The DISPLAY form of the value at which the recommendation flips. Same two
   *  permitted forms as {@link current_display}. */
  flip_display: string;
  /**
   * 1-2 sentence plain-language explanation (max 220 chars), restating the two
   * values in the same display form.
   *
   * ⚠ Named `narrative` by the producer. It was called `plain_english` here
   * until 2.670; the rename is not cosmetic — the old name is a field CEE has
   * never emitted, so it was `Required` and absent on every real review.
   */
  narrative: string;
}

/**
 * Framing check result.
 * Evaluates whether the decision framing is appropriate.
 */
export interface FramingCheck {
  /** Whether the framing addresses the goal */
  addresses_goal: boolean;
  /** Concern about the framing (if any) */
  concern?: string;
  /** Suggested reframe (if applicable) */
  suggested_reframe?: string;
}

/**
 * M1 Review - What CEE Returns
 *
 * The complete decision review output from CEE's /assist/v1/decision-review endpoint.
 * This is validated by PLoT's 9-tier validator before being trusted.
 */
export interface M1Review {
  /** 2-4 sentence narrative summary */
  narrative_summary: string;

  /** Story headlines keyed by option ID */
  story_headlines: Record<string, string>;

  /** Robustness explanation */
  robustness_explanation: RobustnessExplanation;

  /** Rationale for the readiness assessment */
  readiness_rationale: string;

  /** Evidence enhancements keyed by factor ID (from evidence_gaps) */
  evidence_enhancements: Record<string, EvidenceEnhancement>;

  /** Scenario contexts keyed by edge ID (from fragile_edges). Optional when no fragile edges. */
  scenario_contexts?: Record<string, ScenarioContext>;

  /** Bias findings (max 3) */
  bias_findings: BiasFinding[];

  /** Key assumptions (max 5) */
  key_assumptions: string[];

  /** Decision quality prompts (max 3) */
  decision_quality_prompts: DecisionQualityPrompt[];

  /** Pre-mortem analysis (optional) */
  pre_mortem?: PreMortem;

  /** Flip thresholds (max 2, optional) */
  flip_thresholds?: FlipThreshold[];

  /** Framing check (optional) */
  framing_check?: FramingCheck;
}

// =============================================================================
// DecisionReviewRequest — What PLoT Sends to CEE
// =============================================================================

/**
 * Graph node for decision review request.
 * Stripped to essential fields only.
 */
export interface DecisionReviewNode {
  id: string;
  label: string;
  kind: string;
}

/**
 * Graph edge for decision review request.
 */
export interface DecisionReviewEdge {
  /** Edge ID (if available) - needed for edge_id validation */
  id?: string;
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
}

/**
 * Option comparison data from ISL.
 */
export interface OptionComparisonData {
  option_id: string;
  option_label: string;
  win_probability: number;
  /**
   * OPTIONAL: absent when ISL did not measure a finite outcome for this option.
   *
   * ISL #125 made `outcome.mean` Optional — omitted (never null, never 0.0) when
   * the option's Monte Carlo produced no finite draws. Previously required,
   * which forced `extractOptionComparison` to default a missing value to 0 —
   * telling CEE "this option's expected outcome is zero" where the truth was
   * "not computed", and putting that fabricated 0 into the model's grounded-number
   * context. Optional so that absence is representable; consumers MUST branch on
   * presence, never coalesce. (Same treatment as FragileEdgeData.switch_probability.)
   */
  expected_outcome?: number;
}

/**
 * Factor sensitivity data from ISL.
 */
export interface FactorSensitivityData {
  factor_id: string;
  factor_label: string;
  elasticity: number;
  confidence: number;
}

/**
 * Fragile edge data from ISL.
 */
export interface FragileEdgeData {
  edge_id: string;
  from: string;
  to: string;
  /**
   * OPTIONAL: absent when ISL did not measure this edge.
   *
   * Previously required, which forced `extractFragileEdges` to default a
   * missing value to 0 — asserting "this edge will never flip the decision"
   * where the truth was "unknown". Optional so that absence is representable
   * and never has to be fabricated into a claim.
   */
  switch_probability?: number;
  marginal_switch_probability?: number;
}

/**
 * Robustness summary from ISL.
 */
export interface RobustnessData {
  recommendation_stability: number;
  flip_risk_category: string;
  is_robust: boolean;
}

/**
 * Deterministic coaching data from M1 coaching.
 */
export interface DeterministicCoachingData {
  readiness: 'ready' | 'close_call' | 'needs_evidence' | 'needs_framing';
  headline_type: string;
  evidence_gaps: Array<{
    factor_id: string;
    factor_label: string;
    confidence: number;
    voi: number;
  }>;
  model_critiques: Array<{
    type: string;
    severity: string;
    message: string;
    suggested_action?: string;
    affected_node_ids?: string[];
  }>;
}

/**
 * Winner/runner-up option data.
 * Field names match CEE's /assist/v1/decision-review Zod schema.
 */
export interface WinnerData {
  id: string;
  label: string;
  win_probability: number;
  outcome_mean?: number;
}

/**
 * Flip threshold input data.
 * PLoT computes this from factor sensitivity and margin.
 */
export interface FlipThresholdInputData {
  factor_id: string;
  factor_label: string;
  current_value: number;
  /** Null when no flip achievable or heuristic approach */
  flip_value: number | null;
  /**
   * Direction the factor must move from `current_value` to reach `flip_value`.
   *
   * ⚠ OPTIONAL SINCE ROADMAP 2.258 — and the ABSENCE IS THE CLAIM. This is the
   * rowed follow-up the 2.228-F3 note promised, now that its precondition has
   * shipped.
   *
   * ISL emits a direction ONLY beside a real `flip_value`, on the explicit
   * grounds that "a direction for a flip that does not exist would be a
   * fabricated claim". The honest rendering is therefore an ABSENT key. Until
   * 0.31.0 the shared contract did not permit one — `@talchain/schemas` 0.30.0
   * typed `EnrichmentFlipThresholdSchema.direction` as a REQUIRED `z.string()`
   * (`dist/boundary/enrichment.js:473`), so omitting it made PLoT's own
   * enrichment egress guard stamp `enrichment_contract_ok: false` and raise
   * ENRICHMENT_CONTRACT_MISMATCH on every run carrying an attested no-flip: a
   * false alarm on an honest row. The interim `'none'` token existed solely to
   * dodge that alarm while claiming nothing.
   *
   * 0.31.0 relaxes the field to `z.string().optional()`
   * (`dist/boundary/enrichment.js:499`), so the key is now simply omitted and
   * `'none'` is DELETED. See the tombstone in
   * `integrations/isl/adapters/factor-flip-values.ts` before reintroducing it.
   *
   * INVARIANT: `direction === undefined` ⟺ `flip_value === null` on every row
   * this build produces from ISL. Absence is NOT "unknown direction" — pair it
   * with `no_flip_in_range` / `flip_value: null` to know why there is none.
   */
  direction?: 'increase' | 'decrease';
  /**
   * Reason for the flip_value result.
   *
   * ⚠ OPEN VOCABULARY since ROADMAP 2.228-F3 — ISL owns the authoritative list
   * and states it is open, so this is `string` rather than a closed union that
   * would silently reject a token ISL adds. The members below are the ones this
   * build produces or specifically classifies; `flip-threshold-status.ts` is the
   * single place that decides what an unknown token MEANS (it files one as
   * `unresolved`, never as an attested no-effect).
   *
   * ISL closed-form (2.228-F3): 'found' | 'no_effect_within_bounds' |
   * 'structurally_invariant' | 'candidate_cap_exceeded', plus PLoT's
   * 'found_without_value' / 'unattested' guards for producer contradictions.
   *
   * Legacy PLoT probe: 'insufficient_precision' | 'error' | 'timeout' |
   * 'non_monotonic_grid' | 'single_option' | 'heuristic' |
   * 'zero_elasticity_fallback'.
   */
  flip_reason?: string;
  /** Number of binary-search (bisection) iterations used. Grid-fallback probes
   *  are counted in probes_used, not here. */
  iterations_used?: number;
  /**
   * Total probe evaluations COMPLETED for this entry: the 3 Step-0 probes plus
   * any bisection/grid midpoints (completions, not attempts). 0 for heuristic
   * candidates (no probes run yet) and for entries whose probe phase never
   * started. Distinct from iterations_used — probes_used:3 with iterations_used:0
   * means the three probes ran but bisection did not.
   */
  probes_used?: number;
  /** Option that becomes winner after the flip (null if no flip found) */
  alternative_winner_id?: string | null;
  /** Factor unit from observed_state (e.g., "GBP", "%") */
  unit?: string;
  /**
   * Literal `true` when this row is a producer-ATTESTED no-flip — ISL proved or
   * measured that the factor cannot move the winner (review S2, ROADMAP
   * 2.228-F3).
   *
   * ⚠ WHY A BOOLEAN EXISTS AT ALL. CEE recognises an attested no-flip by
   * exact-matching `flip_reason === 'no_effect_within_bounds'`
   * (`src/orchestrator-v5/context/analysis-signals.ts:439`), so every token ISL
   * adds to its OPEN reason vocabulary silently drops out of the coach context.
   * A string-equality mirror across a repo boundary is the dominant defect class
   * here; a boolean cannot drift the same way.
   *
   * ⚠ ABSENT, never `false`. Absence means "not an attested no-flip", which
   * covers BOTH real flips and unresolved rows — it is deliberately NOT the
   * negation of `flip_value === null`. An unresolved row (`timeout`,
   * `candidate_cap_exceeded`, a producer contradiction) has a null flip value
   * and no flag, because nothing was attested about it.
   *
   * ⚠ NOT the same field as CEE's context-pack `no_flip_within_bounds`
   * (`context-pack-schema.ts:166`), despite the near-identical name. That one is
   * CEE-internal, derived only from the single legacy reason string; this one is
   * producer-side and covers every attested no-flip reason.
   */
  no_flip_in_range?: true;
  /**
   * Additive lead-margin diagnostic computed from the Step-0 flip-search probes.
   * Optional — omitted on entries that did not complete the probe phase
   * (pre-probe timeout, non-finite baseline, probe exception, heuristic path).
   */
  margin_sensitivity?: MarginSensitivity;
}

/**
 * Decision Review Request - What PLoT Sends to CEE
 *
 * Assembled from M1 coaching outputs and ISL results.
 * Used to generate the M1Review via CEE's /assist/v1/decision-review endpoint.
 */
export interface DecisionReviewRequest {
  /** The user's decision brief text */
  brief: string;

  /** SHA-256 hash of brief (first 16 chars) */
  brief_hash: string;

  /** Stripped graph */
  graph: {
    nodes: DecisionReviewNode[];
    edges: DecisionReviewEdge[];
  };

  /** ISL results */
  isl_results: {
    option_comparison: OptionComparisonData[];
    factor_sensitivity: FactorSensitivityData[];
    fragile_edges: FragileEdgeData[];
    robustness: RobustnessData;
  };

  /** Deterministic coaching from M1 */
  deterministic_coaching: DeterministicCoachingData;

  /** Winning option */
  winner: WinnerData;

  /** Second-place option (null if only one option) */
  runner_up: WinnerData | null;

  /** Flip threshold data (computed by PLoT) */
  flip_threshold_data: FlipThresholdInputData[];

  /** Explicit margin: winner.win_probability - runner_up.win_probability */
  margin: number;
}

// =============================================================================
// CEE Response Wrapper
// =============================================================================

/**
 * CEE decision review response wrapper.
 * The response from /assist/v1/decision-review endpoint.
 */
export interface CeeDecisionReviewResponse {
  review: M1Review;
  _meta: {
    model: string;
    latency_ms: number;
    tokens: number;
  };
}

// =============================================================================
// Result Types for PLoT
// =============================================================================

/**
 * Decision review result for merging into run response.
 */
export interface DecisionReviewResult {
  m1_review: M1Review | null;
  review_status: ReviewStatus;
  review_meta?: {
    model?: string;
    latency_ms?: number;
    tokens?: number;
  };
  review_failure_codes?: string[];
  review_warnings?: string[];
  /** Reason for skip when review_status is 'skipped' */
  review_skip_reason?: ReviewSkipReason;
}

// =============================================================================
// Zod Schema for M1Review Validation
// =============================================================================

const RobustnessExplanationSchema = z.object({
  summary: z.string(),
  primary_risk: z.string(),
  stability_factors: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_STABILITY_FACTORS),
  fragility_factors: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_FRAGILITY_FACTORS),
});

const EvidenceEnhancementSchema = z.object({
  specific_action: z.string(),
  decision_hygiene: z.string(),
});

const ScenarioContextSchema = z.object({
  trigger_description: z.string(),
  consequence: z.string(),
});

/**
 * ⚠ THE KEYS DECLARED HERE ARE THE ONLY KEYS THAT SURVIVE HOP 6.
 *
 * A bare `z.object()` STRIPS unknown keys — no error, no warning — and this
 * schema sits on the live CEE → PLoT → CEE/UI path
 * (`decision-review-orchestrator.ts:220`). Anything CEE adds to a bias finding
 * and does not add here ceases to exist before a user can see it. That is not
 * hypothetical: `dsk_claim_id` and `evidence_strength` were deleted this way
 * until they were added below.
 *
 * ⚠ DO NOT "FIX" THE NEXT MISSING FIELD WITH `.passthrough()`. A passthrough
 * carries the value untyped and invisible to every consumer, and rejects
 * nothing — it substitutes hazard 2 for hazard 1 rather than closing either.
 * Add the field explicitly. `tests/m1-review-transport-continuity.test.ts`
 * guards both halves: the value must arrive AND the schema must declare it.
 *
 * ⚠ AND THE STRIP IS NOT FULLY CLOSED. Derived key-by-key against CEE's
 * producer at CEE `staging` f1482c0b (`Prompts/canonical/decision_review.txt`
 * + the shape declared in CEE's own `phase3-blocks.ts` header),
 * `suggested_action` is ALSO declared by the producer on every bias finding and
 * is still stripped here. It is left out of this change on purpose — it has no
 * consumer in this repo yet, and adding a field with no reader would be an
 * untested claim — but it is a real gap, not an oversight.
 */
const BiasFindingSchema = z.object({
  type: z.string(),
  source: z.enum(['structural', 'semantic']),
  description: z.string(),
  affected_elements: z.array(z.string()),
  linked_critique_code: z.string().optional(),
  brief_evidence: z.string().optional(),
  // ROADMAP 2.404 mechanism — see the BiasFinding interface for why these are
  // typed as they are, and why `evidence_strength` is not a closed enum.
  dsk_claim_id: z.string().optional(),
  evidence_strength: z.string().optional(),
});

const DecisionQualityPromptSchema = z.object({
  principle: z.string(),
  applies_because: z.string(),
  question: z.string(),
});

const PreMortemSchema = z.object({
  failure_scenario: z.string(),
  warning_signs: z.array(z.string()),
  mitigation: z.string(),
  grounded_in: z.array(z.string()),
  review_trigger: z.string().optional(),
});

/**
 * ROADMAP 2.670 — declared in the PRODUCER's shape (display strings), not in
 * PLoT's own request shape (numbers). See the {@link FlipThreshold} interface
 * for the full derivation and for why the numeric members are gone.
 *
 * Derived from CEE `staging` 658cdff3, two agreeing sources:
 *   - `Prompts/canonical/decision_review.txt:407-425` (the output contract)
 *   - `src/orchestrator-v5/compose/phase3-blocks.ts` header (CEE's own
 *     declaration of the v11 LLM output schema)
 *
 * `direction` is deliberately NOT declared: it appears only on the INPUT
 * (`flip_threshold_data`), never on the row CEE returns. Declaring an optional
 * field no producer emits and no consumer reads would be an untested claim.
 */
const FlipThresholdSchema = z.object({
  factor_id: z.string(),
  factor_label: z.string(),
  current_display: z.string(),
  flip_display: z.string(),
  narrative: z.string(),
});

const FramingCheckSchema = z.object({
  addresses_goal: z.boolean(),
  concern: z.string().optional(),
  suggested_reframe: z.string().optional(),
});

/**
 * Zod schema for M1Review.
 * Used for basic shape validation before the 9-tier semantic validator.
 */
export const M1ReviewSchema = z.object({
  narrative_summary: z.string(),
  story_headlines: z.record(z.string(), z.string()),
  robustness_explanation: RobustnessExplanationSchema,
  readiness_rationale: z.string(),
  evidence_enhancements: z.record(z.string(), EvidenceEnhancementSchema),
  scenario_contexts: z.record(z.string(), ScenarioContextSchema).optional(),
  bias_findings: z.array(BiasFindingSchema).max(M1_REVIEW_LIMITS.MAX_BIAS_FINDINGS),
  key_assumptions: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_KEY_ASSUMPTIONS),
  decision_quality_prompts: z.array(DecisionQualityPromptSchema).max(M1_REVIEW_LIMITS.MAX_DECISION_QUALITY_PROMPTS),
  pre_mortem: PreMortemSchema.optional(),
  flip_thresholds: z.array(FlipThresholdSchema).max(M1_REVIEW_LIMITS.MAX_FLIP_THRESHOLDS).optional(),
  framing_check: FramingCheckSchema.optional(),
});

/**
 * Parse and validate M1Review shape.
 * Returns parsed object or throws ZodError.
 */
export function parseM1Review(data: unknown): M1Review {
  return M1ReviewSchema.parse(data);
}

/**
 * Safe parse M1Review shape.
 * Returns success/error result without throwing.
 */
export function safeParseM1Review(data: unknown): z.SafeParseReturnType<unknown, M1Review> {
  return M1ReviewSchema.safeParse(data);
}
