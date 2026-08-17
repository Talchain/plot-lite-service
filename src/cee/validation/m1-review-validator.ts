/**
 * M1 Review Validator
 *
 * 9-tier validation for LLM-generated decision review output.
 * This is PLoT's trust boundary - verifies CEE output before trusting it.
 *
 * Tiers (blocking = hard failure, warning-grade = downgraded by orchestrator):
 * 1. Option Coverage (warning-grade, B1.2) - story_headlines must match all option IDs
 * 2. Scenario Context References (warning-grade) - edges/options may be paraphrased by LLM
 * 3. Readiness Alignment (warning-grade) - narrative must align with readiness state
 * 4. Number Grounding (warning-grade) - numbers must come from input data
 * 5. Bias Evidence (warning-grade, B1.2) - brief_evidence and critique_code codes are warning-grade
 * 6. Pre-mortem Grounding (warning-grade) - grounding IDs useful but not critical
 * 7. Flip Threshold Integrity (blocking) - MODIFIED_VALUES must match PLoT-computed inputs
 * 8. Structural Limits (warning-grade) - excess items can be truncated
 * 9. Decision Quality Prompt Structure (warning-grade) - minor formatting issues
 *
 * This validator reports ALL findings as errors. The warning-grade classification
 * is applied by the orchestrator (decision-review-orchestrator.ts) via the
 * WARNING_GRADE_CODES set in m1-review-constants.ts. When all failure codes
 * belong to that set, the review is downgraded to 'complete' with warnings.
 *
 * @see Brief: M2 Decision Review Integration, Task 5
 */

import type { M1Review, FlipThresholdInputData } from './m1-review-types.js';
import {
  M1ReviewFailureCodes,
  M1_REVIEW_LIMITS,
  M1_REVIEW_GROUNDING_MAP,
  READINESS_RULES,
} from './m1-review-constants.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Validation context derived from DecisionReviewRequest.
 * Built from the same request object sent to CEE.
 */
export interface ValidationContext {
  /** All option IDs from the request */
  optionIds: string[];
  /** All option labels from the request */
  optionLabels: string[];
  /** Map of option ID to label for consequence validation */
  optionIdToLabel: Record<string, string>;
  /** All edge IDs from the graph */
  edgeIds: string[];
  /** All node IDs from the graph */
  nodeIds: string[];
  /** Fragile edge IDs from ISL results */
  fragileEdgeIds: string[];
  /** Top evidence gap factor IDs (top 3 by VoI) */
  evidenceGapFactorIds: string[];
  /** Readiness state from M1 coaching */
  readiness: string;
  /** Allowed numbers extracted from request (for Tier 4) */
  allowedNumbers: number[];
  /** Original brief text (for Tier 5 brief_evidence) */
  briefText: string;
  /** Flip threshold data from PLoT computation (for Tier 7) */
  flipThresholdData: FlipThresholdInputData[];
}

/**
 * Validation error.
 */
export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

/**
 * Validation warning (non-blocking).
 */
export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
}

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  failure_codes: string[];
  warnings: ValidationWarning[];
}

// =============================================================================
// Main Validator Function
// =============================================================================

/**
 * Validate M1 review against context.
 *
 * Runs all 9 validation tiers and collects errors/warnings.
 * Returns valid=true only if all CRITICAL tiers pass.
 *
 * @param review M1Review from CEE
 * @param context ValidationContext from DecisionReviewRequest
 * @returns ValidationResult with errors, failure_codes, and warnings
 */
export function validateM1Review(
  review: M1Review,
  context: ValidationContext
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Tier 1: Option Coverage (CRITICAL)
  validateOptionCoverage(review, context, errors);

  // Tier 2: Scenario Context References
  validateScenarioContexts(review, context, errors);

  // Tier 3: Readiness Alignment (CRITICAL)
  validateReadinessAlignment(review, context, errors);

  // Tier 4: Number Grounding (CRITICAL)
  validateNumberGrounding(review, context, errors);

  // Tier 5: Bias Evidence
  validateBiasEvidence(review, context, errors);

  // Tier 6: Pre-mortem Grounding
  validatePreMortemGrounding(review, context, errors);

  // Tier 7: Flip Threshold Integrity
  validateFlipThresholds(review, context, errors);

  // Tier 8: Structural Limits
  validateStructuralLimits(review, errors);

  // Tier 9: Decision Quality Prompt Structure
  validateDecisionQualityPrompts(review, errors);

  // Collect unique failure codes
  const failure_codes = [...new Set(errors.map((e) => e.code))];

  return {
    valid: errors.length === 0,
    errors,
    failure_codes,
    warnings,
  };
}

// =============================================================================
// Tier 1: Option Coverage (CRITICAL)
// =============================================================================

/**
 * Validate story_headlines covers ALL option IDs.
 */
function validateOptionCoverage(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  const headlineKeys = Object.keys(review.story_headlines);

  for (const optionId of context.optionIds) {
    if (!headlineKeys.includes(optionId)) {
      errors.push({
        field: `story_headlines.${optionId}`,
        code: M1ReviewFailureCodes.MISSING_OPTION_HEADLINE,
        message: `Missing headline for option: ${optionId}`,
      });
    }
  }
}

// =============================================================================
// Tier 2: Scenario Context References
// =============================================================================

/**
 * Validate scenario_contexts reference valid edges and options.
 */
function validateScenarioContexts(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  if (!review.scenario_contexts) return;

  for (const [edgeId, scenario] of Object.entries(review.scenario_contexts)) {
    // Check edge ID is valid (must be in fragileEdgeIds)
    if (!context.fragileEdgeIds.includes(edgeId)) {
      errors.push({
        field: `scenario_contexts.${edgeId}`,
        code: M1ReviewFailureCodes.INVALID_SCENARIO_EDGE,
        message: `Invalid edge ID: ${edgeId}. Must be a fragile edge.`,
      });
    }

    // Check consequence references valid option (ID or label, case-insensitive for labels)
    const consequence = scenario.consequence.toLowerCase();
    const hasValidOption =
      context.optionIds.some((id) => consequence.includes(id.toLowerCase())) ||
      context.optionLabels.some((label) => consequence.includes(label.toLowerCase()));

    if (!hasValidOption) {
      errors.push({
        field: `scenario_contexts.${edgeId}.consequence`,
        code: M1ReviewFailureCodes.CONSEQUENCE_INVALID_OPTION,
        message: `Consequence must reference a valid option ID or label`,
      });
    }
  }
}

// =============================================================================
// Tier 3: Readiness Alignment (CRITICAL)
// =============================================================================

/**
 * Validate narrative_summary and readiness_rationale align with readiness.
 */
function validateReadinessAlignment(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  const rules = READINESS_RULES[context.readiness];
  if (!rules) return; // Unknown readiness - skip validation

  // Fields to check for alignment
  const fieldsToCheck = [
    { name: 'narrative_summary', value: review.narrative_summary },
    { name: 'readiness_rationale', value: review.readiness_rationale },
  ];

  for (const { name, value } of fieldsToCheck) {
    const lowerValue = value.toLowerCase();

    // Check forbidden phrases
    for (const forbidden of rules.forbidden) {
      if (lowerValue.includes(forbidden.toLowerCase())) {
        errors.push({
          field: name,
          code: M1ReviewFailureCodes.READINESS_CONTRADICTION,
          message: `"${forbidden}" contradicts readiness state: ${context.readiness}`,
        });
      }
    }

    // Check required phrases (if any)
    if (rules.required_any && rules.required_any.length > 0) {
      const hasRequired = rules.required_any.some((phrase) =>
        lowerValue.includes(phrase.toLowerCase())
      );
      if (!hasRequired) {
        errors.push({
          field: name,
          code: M1ReviewFailureCodes.READINESS_MISALIGNMENT,
          message: `Must include one of: ${rules.required_any.join(', ')} for readiness: ${context.readiness}`,
        });
      }
    }
  }
}

// =============================================================================
// Tier 4: Number Grounding (CRITICAL)
// =============================================================================

/**
 * Extract numbers from text.
 * Matches: integers, decimals, percentages (strips % sign).
 * Ignores: ordinals (1st, 2nd, 3rd).
 */
export function extractNumbers(text: string): number[] {
  const numbers: number[] = [];

  // Match patterns: "77%", "0.85", "34", "-12.5", "34-point"
  // Regex captures numbers with optional % or decimal
  const regex = /(?<!\d)(-?\d+(?:\.\d+)?)\s*%?(?!st|nd|rd|th)/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const numStr = match[1];
    const num = parseFloat(numStr);
    if (Number.isFinite(num)) {
      numbers.push(num);
    }
  }

  return numbers;
}

/**
 * Check if a number is grounded (matches allowed numbers within tolerance).
 * Handles %/decimal normalisation.
 */
export function isGroundedNumber(
  num: number,
  allowed: number[],
  tolerance: number = 0.05
): boolean {
  return allowed.some((a) => {
    // Direct match: 0.77 ≈ 0.77
    if (Math.abs(num - a) <= Math.abs(a) * tolerance) return true;
    // Percentage match: 77 ≈ 0.77
    if (Math.abs(num - a * 100) <= Math.abs(a * 100) * tolerance) return true;
    // Inverse: 0.77 ≈ 77
    if (a !== 0 && Math.abs(num / 100 - a) <= Math.abs(a) * tolerance) return true;
    // Zero handling
    if (a === 0 && Math.abs(num) < 0.01) return true;
    return false;
  });
}

/**
 * Validate numbers in grounded fields come from input data.
 */
function validateNumberGrounding(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  // Extract and validate numbers from grounded fields
  const groundedFields = getGroundedFieldValues(review);

  for (const { fieldPath, value } of groundedFields) {
    const numbers = extractNumbers(value);
    for (const num of numbers) {
      if (!isGroundedNumber(num, context.allowedNumbers)) {
        errors.push({
          field: fieldPath,
          code: M1ReviewFailureCodes.UNGROUNDED_NUMBER,
          message: `Number ${num} not found in input data`,
        });
      }
    }
  }
}

/**
 * Get values from grounded fields for number extraction.
 */
function getGroundedFieldValues(
  review: M1Review
): Array<{ fieldPath: string; value: string }> {
  const results: Array<{ fieldPath: string; value: string }> = [];

  // Simple string fields
  if (isGroundedField('narrative_summary')) {
    results.push({ fieldPath: 'narrative_summary', value: review.narrative_summary });
  }
  if (isGroundedField('readiness_rationale')) {
    results.push({ fieldPath: 'readiness_rationale', value: review.readiness_rationale });
  }

  // Robustness explanation fields
  if (isGroundedField('robustness_explanation.summary')) {
    results.push({ fieldPath: 'robustness_explanation.summary', value: review.robustness_explanation.summary });
  }
  if (isGroundedField('robustness_explanation.primary_risk')) {
    results.push({ fieldPath: 'robustness_explanation.primary_risk', value: review.robustness_explanation.primary_risk });
  }

  // Array fields
  if (isGroundedField('robustness_explanation.stability_factors')) {
    review.robustness_explanation.stability_factors.forEach((factor, i) => {
      results.push({ fieldPath: `robustness_explanation.stability_factors[${i}]`, value: factor });
    });
  }
  if (isGroundedField('robustness_explanation.fragility_factors')) {
    review.robustness_explanation.fragility_factors.forEach((factor, i) => {
      results.push({ fieldPath: `robustness_explanation.fragility_factors[${i}]`, value: factor });
    });
  }

  // Bias findings descriptions
  if (isGroundedField('bias_findings.description')) {
    review.bias_findings.forEach((finding, i) => {
      results.push({ fieldPath: `bias_findings[${i}].description`, value: finding.description });
    });
  }

  // Scenario contexts
  if (review.scenario_contexts && isGroundedField('scenario_contexts.trigger_description')) {
    for (const [key, ctx] of Object.entries(review.scenario_contexts)) {
      results.push({ fieldPath: `scenario_contexts.${key}.trigger_description`, value: ctx.trigger_description });
      if (isGroundedField('scenario_contexts.consequence')) {
        results.push({ fieldPath: `scenario_contexts.${key}.consequence`, value: ctx.consequence });
      }
    }
  }

  return results;
}

/**
 * Check if a field path is classified as grounded.
 */
function isGroundedField(fieldPath: string): boolean {
  return M1_REVIEW_GROUNDING_MAP[fieldPath] === 'grounded';
}

// =============================================================================
// Tier 5: Bias Evidence
// =============================================================================

/**
 * Validate bias findings have required evidence fields.
 */
function validateBiasEvidence(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  for (let i = 0; i < review.bias_findings.length; i++) {
    const finding = review.bias_findings[i];

    if (finding.source === 'structural') {
      // Must have linked_critique_code
      if (!finding.linked_critique_code || finding.linked_critique_code.trim() === '') {
        errors.push({
          field: `bias_findings[${i}].linked_critique_code`,
          code: M1ReviewFailureCodes.MISSING_CRITIQUE_CODE,
          message: 'Structural bias finding must have linked_critique_code',
        });
      }
    } else if (finding.source === 'semantic') {
      // Must have brief_evidence
      if (!finding.brief_evidence) {
        errors.push({
          field: `bias_findings[${i}].brief_evidence`,
          code: M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE,
          message: 'Semantic bias finding must have brief_evidence',
        });
        continue;
      }

      // Must be at least 12 characters
      if (finding.brief_evidence.length < 12) {
        errors.push({
          field: `bias_findings[${i}].brief_evidence`,
          code: M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT,
          message: `brief_evidence must be at least 12 characters (got ${finding.brief_evidence.length})`,
        });
        continue;
      }

      // Must be exact substring (case-sensitive)
      if (!context.briefText.includes(finding.brief_evidence)) {
        errors.push({
          field: `bias_findings[${i}].brief_evidence`,
          code: M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING,
          message: 'brief_evidence must be an exact substring of the brief',
        });
      }
    }
  }
}

// =============================================================================
// Tier 6: Pre-mortem Grounding
// =============================================================================

/**
 * Validate pre_mortem.grounded_in references valid IDs.
 */
function validatePreMortemGrounding(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  if (!review.pre_mortem) return;

  const validIds = new Set([
    ...context.fragileEdgeIds,
    ...context.evidenceGapFactorIds,
  ]);

  if (review.pre_mortem.grounded_in.length === 0) {
    errors.push({
      field: 'pre_mortem.grounded_in',
      code: M1ReviewFailureCodes.PREMORTEM_NOT_GROUNDED,
      message: 'pre_mortem must have at least one grounding ID',
    });
    return;
  }

  for (const id of review.pre_mortem.grounded_in) {
    if (!validIds.has(id)) {
      errors.push({
        field: `pre_mortem.grounded_in`,
        code: M1ReviewFailureCodes.INVALID_GROUNDING_ID,
        message: `Invalid grounding ID: ${id}. Must be fragile edge or evidence gap factor ID.`,
      });
    }
  }
}

// =============================================================================
// Tier 7: Flip Threshold Integrity
// =============================================================================

/**
 * Numeric tokeniser. Deliberately the SAME expression CEE's own agreement rung
 * uses to check a display string against the value it names (quoted in
 * `flip-threshold-denormaliser.ts:517`), so the two sides of the boundary judge
 * a display form by the same rule rather than by two hand-written mirrors.
 */
const DISPLAY_NUMBER_TOKEN = /-?\d+(?:\.\d+)?/g;

/**
 * The single number a display string names, or `null` when that is not
 * decidable. Zero tokens ("significantly lower") and several tokens ("Q3 2026")
 * are both undecidable: see {@link validateFlipThresholds} for why undecidable
 * must mean "no error".
 */
function soleNumberToken(display: unknown): string | null {
  // Typed `unknown`, not `string`, deliberately. `validateM1Review` is exported
  // and is called directly on unparsed objects (several suites do exactly that),
  // so a missing or non-string display must return "undecidable" rather than
  // throw — a TypeError raised inside validation would escape as a 500 on a path
  // whose entire job is to degrade gracefully.
  if (typeof display !== 'string') return null;
  const tokens = display.match(DISPLAY_NUMBER_TOKEN);
  if (!tokens || tokens.length !== 1) return null;
  return Number.isFinite(Number(tokens[0])) ? tokens[0] : null;
}

function soleNumberNamed(display: unknown): number | null {
  const token = soleNumberToken(display);
  return token === null ? null : Number(token);
}

/**
 * Decimal places written in a numeric TOKEN (not in the double it parses to).
 * `"41"` → 0, `"40.74"` → 2. Clamped to `toFixed`'s 100-digit ceiling so a
 * pathologically long token cannot throw inside validation.
 *
 * The token is the right source, not the parsed value: the question this
 * answers is "to what precision did the producer choose to write this?", and
 * `String(Number("40.70"))` has already thrown that away.
 */
function writtenDecimals(token: string): number {
  const dot = token.indexOf('.');
  return dot === -1 ? 0 : Math.min(100, token.length - dot - 1);
}

/**
 * Does `display` name `expected`, under one of the producer's two permitted
 * display forms?
 *
 * Derived from CEE `staging` 658cdff3,
 * `Prompts/canonical/decision_review.txt:411-423` — there are exactly two forms
 * and the prompt states there is no third:
 *   1. The value carries a unit → quoted verbatim with the unit appended
 *      ("16000 GBP"). The number named is the value itself.
 *   2. The value carries no unit and lies between 0 and 1 → probability-like, so
 *      the percentage form ("35%" for 0.35). The number named is value × 100,
 *      and the prompt calls this "the one permitted transformation".
 *
 * Identity is accepted unconditionally, including for unitless values outside
 * [0,1] — the prompt describes no display form for those, so refusing them here
 * would invent a rule the producer was never given.
 */
function displayNamesValue(
  display: unknown,
  expected: number,
  unit: string | undefined
): boolean {
  const token = soleNumberToken(display);
  if (token === null) return false;
  const named = Number(token);

  // Case 1 — verbatim. EXACT, and deliberately so: the prompt says a
  // unit-bearing value is quoted verbatim, `formatUserScale` only ever writes
  // digits that round-trip losslessly, and CEE's own agreement rung compares
  // with `===`. "12000 GBP" against 12243 is a different number, not a
  // rendering choice.
  if (named === expected) return true;

  // Case 2 — percentage form, permitted only for a unitless probability-like
  // value, and permitted AT THE PRECISION THE PRODUCER WROTE.
  //
  // ⚠ ROADMAP 2.676 — THIS COMPARISON USED TO BE A FLOAT-ERROR TOLERANCE
  // (`max(|asPercent|, 1) × 1e-9`) AND IT WAS DISCARDING HEALTHY REVIEWS.
  // Measured on deployed CEE: handed `flip_value: 0.407407` unitless, gpt-4.1
  // returned `"41%"` — the licensed form, rounded to whole percent as a human
  // would write it. `|41 − 40.7407| = 0.2593` is four orders of magnitude
  // outside a 1e-9 slack, so BLOCKING `MODIFIED_VALUES` fired and the entire
  // review was thrown away, four live samples of four. The old tolerance was
  // sized for the arithmetic error this function introduces itself, and was
  // then asked to adjudicate a rendering decision it was never scaled for.
  //
  // The rule now: round `expected × 100` to the number of decimals the producer
  // actually WROTE, and compare. This is strictly stronger than the epsilon it
  // replaces — it subsumes the float-error case (`0.29 × 100` is
  // 28.999999999999996, which `toFixed(0)` renders "29") — while admitting the
  // rounding the prompt never forbade. It gives away NO discriminating power:
  // "42%" still fails against 0.407407, because 40.7407 rounds to 41, not 42.
  //
  // Error direction is preserved: this tier fires only when it can PROVE two
  // numbers differ (see the note on {@link validateFlipThresholds}), and a
  // value written to fewer significant figures is not proof of anything.
  const unitless = typeof unit !== 'string' || unit.trim().length === 0;
  if (unitless && expected >= 0 && expected <= 1) {
    const asPercent = expected * 100;
    if (named === Number(asPercent.toFixed(writtenDecimals(token)))) return true;
  }

  return false;
}

/**
 * Validate that the flip thresholds CEE returned still name the numbers PLoT
 * sent — the anti-fabrication guard for this block.
 *
 * ⚠ ROADMAP 2.670 — RE-EXPRESSED, NOT RELAXED. This tier used to compare
 * `threshold.current_value !== expected.current_value` numerically. The producer
 * does not return numbers: it returns the DISPLAY FORM of PLoT's numbers as
 * strings (see {@link FlipThreshold}). Deleting the tier along with the numeric
 * fields would have quietly retired a BLOCKING data-integrity guard while the
 * schema change was being reviewed for something else — so the check now proves
 * the same property against the shape the producer actually sends: the number
 * NAMED in the display string must be the number PLoT supplied.
 *
 * ⚠ WHY AN UNDECIDABLE DISPLAY RAISES NO ERROR. `MODIFIED_VALUES` is one of the
 * few BLOCKING codes (`WARNING_GRADE_CODES` excludes it), so a false positive
 * here discards the entire review — the exact failure mode 2.670 exists to
 * close. The old guard only ever fired when it could PROVE two numbers differed;
 * this one keeps that character deliberately. A display naming no number, or
 * several, is a formatting problem this tier cannot adjudicate, and it is not
 * evidence that a value was modified. Error direction is therefore fail-open on
 * ambiguity and fail-closed on a provable contradiction.
 */
function validateFlipThresholds(
  review: M1Review,
  context: ValidationContext,
  errors: ValidationError[]
): void {
  if (!review.flip_thresholds || review.flip_thresholds.length === 0) return;
  if (context.flipThresholdData.length === 0) return;

  for (const threshold of review.flip_thresholds) {
    const expected = context.flipThresholdData.find(
      (t) => t.factor_id === threshold.factor_id
    );

    if (!expected) {
      // Factor not in PLoT-computed data - this is acceptable if CEE added it
      continue;
    }

    // Verify current_display still names the value PLoT sent.
    if (!displayNamesValue(threshold.current_display, expected.current_value, expected.unit)) {
      if (soleNumberNamed(threshold.current_display) !== null) {
        errors.push({
          field: `flip_thresholds.${threshold.factor_id}.current_display`,
          code: M1ReviewFailureCodes.MODIFIED_VALUES,
          message: `current_display names a different value: expected ${expected.current_value}${expected.unit ? ` ${expected.unit}` : ''}, got "${threshold.current_display}"`,
        });
      }
    }

    // Only verify flip_display if PLoT computed a flip value (not null).
    if (
      expected.flip_value !== null &&
      !displayNamesValue(threshold.flip_display, expected.flip_value, expected.unit)
    ) {
      if (soleNumberNamed(threshold.flip_display) !== null) {
        errors.push({
          field: `flip_thresholds.${threshold.factor_id}.flip_display`,
          code: M1ReviewFailureCodes.MODIFIED_VALUES,
          message: `flip_display names a different value: expected ${expected.flip_value}${expected.unit ? ` ${expected.unit}` : ''}, got "${threshold.flip_display}"`,
        });
      }
    }
  }
}

// =============================================================================
// Tier 8: Structural Limits
// =============================================================================

/**
 * Validate arrays respect max lengths.
 */
function validateStructuralLimits(
  review: M1Review,
  errors: ValidationError[]
): void {
  if (review.bias_findings.length > M1_REVIEW_LIMITS.MAX_BIAS_FINDINGS) {
    errors.push({
      field: 'bias_findings',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `bias_findings exceeds limit: ${review.bias_findings.length} > ${M1_REVIEW_LIMITS.MAX_BIAS_FINDINGS}`,
    });
  }

  if (review.key_assumptions.length > M1_REVIEW_LIMITS.MAX_KEY_ASSUMPTIONS) {
    errors.push({
      field: 'key_assumptions',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `key_assumptions exceeds limit: ${review.key_assumptions.length} > ${M1_REVIEW_LIMITS.MAX_KEY_ASSUMPTIONS}`,
    });
  }

  if (review.decision_quality_prompts.length > M1_REVIEW_LIMITS.MAX_DECISION_QUALITY_PROMPTS) {
    errors.push({
      field: 'decision_quality_prompts',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `decision_quality_prompts exceeds limit: ${review.decision_quality_prompts.length} > ${M1_REVIEW_LIMITS.MAX_DECISION_QUALITY_PROMPTS}`,
    });
  }

  if (review.flip_thresholds && review.flip_thresholds.length > M1_REVIEW_LIMITS.MAX_FLIP_THRESHOLDS) {
    errors.push({
      field: 'flip_thresholds',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `flip_thresholds exceeds limit: ${review.flip_thresholds.length} > ${M1_REVIEW_LIMITS.MAX_FLIP_THRESHOLDS}`,
    });
  }

  if (review.robustness_explanation.stability_factors.length > M1_REVIEW_LIMITS.MAX_STABILITY_FACTORS) {
    errors.push({
      field: 'robustness_explanation.stability_factors',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `stability_factors exceeds limit: ${review.robustness_explanation.stability_factors.length} > ${M1_REVIEW_LIMITS.MAX_STABILITY_FACTORS}`,
    });
  }

  if (review.robustness_explanation.fragility_factors.length > M1_REVIEW_LIMITS.MAX_FRAGILITY_FACTORS) {
    errors.push({
      field: 'robustness_explanation.fragility_factors',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `fragility_factors exceeds limit: ${review.robustness_explanation.fragility_factors.length} > ${M1_REVIEW_LIMITS.MAX_FRAGILITY_FACTORS}`,
    });
  }

  if (review.scenario_contexts && Object.keys(review.scenario_contexts).length > M1_REVIEW_LIMITS.MAX_SCENARIO_CONTEXTS) {
    errors.push({
      field: 'scenario_contexts',
      code: M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,
      message: `scenario_contexts exceeds limit: ${Object.keys(review.scenario_contexts).length} > ${M1_REVIEW_LIMITS.MAX_SCENARIO_CONTEXTS}`,
    });
  }
}

// =============================================================================
// Tier 9: Decision Quality Prompt Structure
// =============================================================================

/**
 * Validate decision quality prompts have proper structure.
 */
function validateDecisionQualityPrompts(
  review: M1Review,
  errors: ValidationError[]
): void {
  for (let i = 0; i < review.decision_quality_prompts.length; i++) {
    const prompt = review.decision_quality_prompts[i];

    // principle must be non-empty
    if (!prompt.principle || prompt.principle.trim() === '') {
      errors.push({
        field: `decision_quality_prompts[${i}].principle`,
        code: M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE,
        message: 'principle must be non-empty',
      });
    }

    // applies_because must be non-empty
    if (!prompt.applies_because || prompt.applies_because.trim() === '') {
      errors.push({
        field: `decision_quality_prompts[${i}].applies_because`,
        code: M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE,
        message: 'applies_because must be non-empty',
      });
    }

    // question must end with ?
    if (!prompt.question || !prompt.question.trim().endsWith('?')) {
      errors.push({
        field: `decision_quality_prompts[${i}].question`,
        code: M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE,
        message: 'question must end with ?',
      });
    }
  }
}

// =============================================================================
// Scenario Context Cap (pre-validation corrective step)
// =============================================================================

/**
 * Result of capping scenario_contexts.
 */
export interface ScenarioContextCapResult {
  /** Review with scenario_contexts truncated to MAX_SCENARIO_CONTEXTS */
  review: M1Review;
  /** Whether truncation occurred */
  truncated: boolean;
  /** Edge IDs that were removed */
  removedKeys: string[];
  /** Warning message (empty string if no truncation) */
  warning: string;
}

/**
 * Cap scenario_contexts at MAX_SCENARIO_CONTEXTS.
 *
 * Truncates by relevance when fragile edge data is available (higher
 * switch_probability = more relevant, kept first). Falls back to
 * insertion order when probabilities are unavailable.
 *
 * @param review Parsed M1Review (not mutated)
 * @param fragileEdges Fragile edge data with switch probabilities for relevance ranking
 * @returns Capped review + diagnostic info
 */
export function capScenarioContexts(
  review: M1Review,
  // switch_probability is OPTIONAL: absent means ISL did not measure the edge.
  // The ranking below already handles that honestly via `?? -1`, which sinks an
  // unmeasured edge below every measured one instead of treating it as 0 (a
  // maximal-robustness claim we have no basis for).
  fragileEdges: Array<{ edge_id: string; switch_probability?: number }> = []
): ScenarioContextCapResult {
  if (!review.scenario_contexts) {
    return { review, truncated: false, removedKeys: [], warning: '' };
  }

  const entries = Object.entries(review.scenario_contexts);
  const limit = M1_REVIEW_LIMITS.MAX_SCENARIO_CONTEXTS;

  if (entries.length <= limit) {
    return { review, truncated: false, removedKeys: [], warning: '' };
  }

  // Build switch_probability lookup for relevance ranking
  const switchProbMap = new Map(
    fragileEdges.map((e) => [e.edge_id, e.switch_probability])
  );

  // Sort by switch_probability descending (most fragile = most relevant)
  const sorted = [...entries].sort(([a], [b]) => {
    const probA = switchProbMap.get(a) ?? -1;
    const probB = switchProbMap.get(b) ?? -1;
    return probB - probA;
  });

  const kept = sorted.slice(0, limit);
  const removed = sorted.slice(limit);
  const removedKeys = removed.map(([key]) => key);

  const warning =
    `scenario_contexts capped at ${limit}: removed ${removedKeys.join(', ')}` +
    ` (had ${entries.length}, limit ${limit})`;

  return {
    review: {
      ...review,
      scenario_contexts: Object.fromEntries(kept),
    },
    truncated: true,
    removedKeys,
    warning,
  };
}

// =============================================================================
// Context Builder
// =============================================================================

/**
 * Build ValidationContext from DecisionReviewRequest.
 *
 * This ensures the validation context is derived from the same data
 * sent to CEE, eliminating drift between what CEE sees and what we validate.
 */
export function buildValidationContext(
  request: {
    brief: string;
    graph: { nodes: Array<{ id: string; label: string }>; edges: Array<{ id?: string }> };
    isl_results: {
      option_comparison: Array<{ option_id: string; option_label: string; win_probability: number }>;
      factor_sensitivity: Array<{ factor_id: string; elasticity: number; confidence: number }>;
      fragile_edges: Array<{ edge_id: string; switch_probability?: number; marginal_switch_probability?: number }>;
      robustness: { recommendation_stability?: number };
    };
    deterministic_coaching: {
      readiness: string;
      evidence_gaps: Array<{ factor_id: string; voi: number }>;
    };
    flip_threshold_data: FlipThresholdInputData[];
    margin: number;
  }
): ValidationContext {
  // Build allowed numbers from all numeric values in the request
  const allowedNumbers: number[] = [];

  // Win probabilities
  for (const opt of request.isl_results.option_comparison) {
    allowedNumbers.push(opt.win_probability);
  }

  // Recommendation stability. 2.1248: only a MEASURED stability is grounded —
  // the old required field forced a fabricated 0 into this allowlist, which
  // let the review cite "0" as a grounded figure for a run ISL never assessed.
  if (typeof request.isl_results.robustness.recommendation_stability === 'number') {
    allowedNumbers.push(request.isl_results.robustness.recommendation_stability);
  }

  // Elasticity and confidence values
  for (const f of request.isl_results.factor_sensitivity) {
    allowedNumbers.push(f.elasticity);
    allowedNumbers.push(f.confidence);
  }

  // Switch probabilities. Both are guarded: an unmeasured edge has no
  // switch_probability, and pushing `undefined` into the grounded-number
  // allowlist would be meaningless at best. Previously switch_probability was
  // always a number only because the extractor defaulted it to a fabricated 0
  // — which also put a fabricated 0 into this allowlist, licensing the
  // reviewer to state it as a grounded figure.
  for (const e of request.isl_results.fragile_edges) {
    if (e.switch_probability !== undefined) {
      allowedNumbers.push(e.switch_probability);
    }
    if (e.marginal_switch_probability !== undefined) {
      allowedNumbers.push(e.marginal_switch_probability);
    }
  }

  // VoI and confidence from evidence gaps
  for (const gap of request.deterministic_coaching.evidence_gaps) {
    allowedNumbers.push(gap.voi);
  }

  // Flip threshold values
  for (const t of request.flip_threshold_data) {
    allowedNumbers.push(t.current_value);
    if (t.flip_value !== null) {
      allowedNumbers.push(t.flip_value);
    }
  }

  // Margin
  allowedNumbers.push(request.margin);

  // Build option ID to label map
  const optionIdToLabel: Record<string, string> = {};
  for (const opt of request.isl_results.option_comparison) {
    optionIdToLabel[opt.option_id] = opt.option_label;
  }

  // Get top 3 evidence gap factor IDs by VoI
  const topEvidenceGaps = [...request.deterministic_coaching.evidence_gaps]
    .sort((a, b) => b.voi - a.voi)
    .slice(0, 3)
    .map((g) => g.factor_id);

  return {
    optionIds: request.isl_results.option_comparison.map((o) => o.option_id),
    optionLabels: request.isl_results.option_comparison.map((o) => o.option_label),
    optionIdToLabel,
    edgeIds: request.graph.edges.map((e) => e.id ?? '').filter((id) => id !== ''),
    nodeIds: request.graph.nodes.map((n) => n.id),
    fragileEdgeIds: request.isl_results.fragile_edges.map((e) => e.edge_id),
    evidenceGapFactorIds: topEvidenceGaps,
    readiness: request.deterministic_coaching.readiness,
    allowedNumbers: [...new Set(allowedNumbers)], // Dedupe
    briefText: request.brief,
    flipThresholdData: request.flip_threshold_data,
  };
}
