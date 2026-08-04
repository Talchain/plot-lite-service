/**
 * Number Corrector
 *
 * Deterministic post-processor that corrects drifted numbers in M1 review
 * narrative fields before validation. This allows minor LLM drift (10-25%)
 * to be corrected rather than causing validation failure.
 *
 * @see Brief: Deterministic Number Correction + Validation Downgrade
 */

import type { M1Review } from './m1-review-types.js';
import { M1_REVIEW_GROUNDING_MAP } from './m1-review-constants.js';

// =============================================================================
// Types
// =============================================================================

/**
 * ISL results subset needed for number correction.
 */
export interface IslResultsForCorrection {
  option_comparison: Array<{
    option_id: string;
    option_label: string;
    win_probability: number;
    expected_outcome?: number;
  }>;
  robustness: {
    recommendation_stability: number;
    overall_confidence?: number;
  };
  factor_sensitivity: Array<{
    factor_id: string;
    elasticity: number;
    confidence?: number;
  }>;
}

/**
 * Record of a single number correction.
 */
export interface NumberCorrection {
  /** Field path where correction was made (e.g., 'narrative_summary') */
  field: string;
  /** The number as written by LLM */
  original_text: string;
  /** The replacement text */
  corrected_text: string;
  /** Source ISL field (e.g., 'winner.win_probability') */
  isl_source: string;
  /** The authoritative ISL value */
  isl_value: number;
  /** How far off the LLM was (as percentage) */
  drift_percent: number;
}

/**
 * Result of number correction.
 */
export interface CorrectionResult {
  /** Corrected M1Review (or original if no corrections) */
  corrected: M1Review;
  /** List of corrections made */
  corrections: NumberCorrection[];
}

/**
 * Internal representation of an ISL number source.
 */
interface IslNumberSource {
  value: number;
  source: string;
  /** Whether this value is typically expressed as percentage (0.74 → 74%) */
  isPercentage: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum drift threshold - numbers closer than this pass validation (aligns with validator's 5% tolerance) */
const MIN_DRIFT_THRESHOLD = 0.05; // 5%

/** Maximum drift threshold - numbers farther than this aren't corrections (different quantity entirely) */
const MAX_DRIFT_THRESHOLD = 0.25; // 25%

// =============================================================================
// Main Function
// =============================================================================

/**
 * Correct ungrounded numbers in M1 review grounded fields.
 *
 * Scans grounded fields for numbers that drift 10-25% from ISL values.
 * Numbers within 10% pass validation anyway. Numbers beyond 25% are
 * considered different quantities (not drifted references).
 *
 * @param review M1Review from CEE
 * @param islResults ISL results for authoritative values
 * @param winnerOptionId Winner option ID (for margin calculation)
 * @param runnerUpOptionId Runner-up option ID (for margin calculation)
 * @returns Corrected review and list of corrections
 */
export function correctUngroundedNumbers(
  review: M1Review,
  islResults: IslResultsForCorrection,
  winnerOptionId?: string,
  runnerUpOptionId?: string
): CorrectionResult {
  const corrections: NumberCorrection[] = [];

  // Build ISL number sources
  const islSources = buildIslNumberSources(islResults, winnerOptionId, runnerUpOptionId);

  // Deep clone review to avoid mutation
  const corrected = JSON.parse(JSON.stringify(review)) as M1Review;

  // Correct each grounded field
  correctField(corrected, 'narrative_summary', islSources, corrections);
  correctField(corrected, 'readiness_rationale', islSources, corrections);

  // Robustness explanation fields
  correctNestedField(corrected, 'robustness_explanation', 'summary', islSources, corrections);
  correctNestedField(corrected, 'robustness_explanation', 'primary_risk', islSources, corrections);
  correctArrayField(corrected, 'robustness_explanation', 'stability_factors', islSources, corrections);
  correctArrayField(corrected, 'robustness_explanation', 'fragility_factors', islSources, corrections);

  // Bias findings descriptions
  correctBiasFindings(corrected, islSources, corrections);

  // Scenario contexts
  correctScenarioContexts(corrected, islSources, corrections);

  return { corrected, corrections };
}

// =============================================================================
// ISL Source Building
// =============================================================================

/**
 * Build list of ISL number sources for matching.
 */
function buildIslNumberSources(
  islResults: IslResultsForCorrection,
  winnerOptionId?: string,
  runnerUpOptionId?: string
): IslNumberSource[] {
  const sources: IslNumberSource[] = [];

  // Win probabilities
  for (const opt of islResults.option_comparison) {
    sources.push({
      value: opt.win_probability,
      source: `option_comparison.${opt.option_id}.win_probability`,
      isPercentage: true,
    });
    if (opt.expected_outcome !== undefined) {
      sources.push({
        value: opt.expected_outcome,
        source: `option_comparison.${opt.option_id}.expected_outcome`,
        isPercentage: false,
      });
    }
  }

  // Winner/runner-up specific
  const winner = islResults.option_comparison.find((o) => o.option_id === winnerOptionId);
  const runnerUp = islResults.option_comparison.find((o) => o.option_id === runnerUpOptionId);

  if (winner) {
    sources.push({
      value: winner.win_probability,
      source: 'winner.win_probability',
      isPercentage: true,
    });
  }
  if (runnerUp) {
    sources.push({
      value: runnerUp.win_probability,
      source: 'runner_up.win_probability',
      isPercentage: true,
    });
  }

  // Margin (winner - runner_up)
  if (winner && runnerUp) {
    const margin = winner.win_probability - runnerUp.win_probability;
    sources.push({
      value: margin,
      source: 'margin',
      isPercentage: true, // Margin expressed as percentage points
    });
  }

  // Robustness
  sources.push({
    value: islResults.robustness.recommendation_stability,
    source: 'robustness.recommendation_stability',
    isPercentage: true,
  });
  if (islResults.robustness.overall_confidence !== undefined) {
    sources.push({
      value: islResults.robustness.overall_confidence,
      source: 'robustness.overall_confidence',
      isPercentage: true,
    });
  }

  // Factor sensitivity
  for (const factor of islResults.factor_sensitivity) {
    sources.push({
      value: factor.elasticity,
      source: `factor_sensitivity.${factor.factor_id}.elasticity`,
      isPercentage: false,
    });
    if (factor.confidence !== undefined) {
      sources.push({
        value: factor.confidence,
        source: `factor_sensitivity.${factor.factor_id}.confidence`,
        isPercentage: true,
      });
    }
  }

  return sources;
}

// =============================================================================
// Field Correction Functions
// =============================================================================

/**
 * Correct numbers in a simple string field.
 */
function correctField(
  review: M1Review,
  fieldPath: keyof M1Review,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): void {
  if (!isGroundedField(fieldPath)) return;

  const value = review[fieldPath];
  if (typeof value !== 'string' || !value) return;

  const correctedValue = correctTextNumbers(value, fieldPath, islSources, corrections);
  (review as any)[fieldPath] = correctedValue;
}

/**
 * Correct numbers in a nested object field.
 */
function correctNestedField(
  review: M1Review,
  parentKey: keyof M1Review,
  childKey: string,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): void {
  const fieldPath = `${parentKey}.${childKey}`;
  if (!isGroundedField(fieldPath)) return;

  const parent = review[parentKey] as Record<string, any>;
  if (!parent || typeof parent[childKey] !== 'string') return;

  const correctedValue = correctTextNumbers(
    parent[childKey],
    fieldPath,
    islSources,
    corrections
  );
  parent[childKey] = correctedValue;
}

/**
 * Correct numbers in an array of strings field.
 */
function correctArrayField(
  review: M1Review,
  parentKey: keyof M1Review,
  childKey: string,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): void {
  const fieldPath = `${parentKey}.${childKey}`;
  if (!isGroundedField(fieldPath)) return;

  const parent = review[parentKey] as Record<string, any>;
  if (!parent || !Array.isArray(parent[childKey])) return;

  parent[childKey] = parent[childKey].map((item: string, index: number) => {
    if (typeof item !== 'string') return item;
    return correctTextNumbers(
      item,
      `${fieldPath}[${index}]`,
      islSources,
      corrections
    );
  });
}

/**
 * Correct numbers in bias findings descriptions.
 */
function correctBiasFindings(
  review: M1Review,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): void {
  if (!isGroundedField('bias_findings.description')) return;
  if (!review.bias_findings) return;

  for (let i = 0; i < review.bias_findings.length; i++) {
    const finding = review.bias_findings[i];
    if (typeof finding.description === 'string') {
      finding.description = correctTextNumbers(
        finding.description,
        `bias_findings[${i}].description`,
        islSources,
        corrections
      );
    }
  }
}

/**
 * Correct numbers in scenario contexts.
 */
function correctScenarioContexts(
  review: M1Review,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): void {
  if (!review.scenario_contexts) return;

  for (const [key, ctx] of Object.entries(review.scenario_contexts)) {
    if (isGroundedField('scenario_contexts.trigger_description')) {
      ctx.trigger_description = correctTextNumbers(
        ctx.trigger_description,
        `scenario_contexts.${key}.trigger_description`,
        islSources,
        corrections
      );
    }
    if (isGroundedField('scenario_contexts.consequence')) {
      ctx.consequence = correctTextNumbers(
        ctx.consequence,
        `scenario_contexts.${key}.consequence`,
        islSources,
        corrections
      );
    }
  }
}

// =============================================================================
// Core Correction Logic
// =============================================================================

/**
 * Correct drifted numbers in text.
 */
function correctTextNumbers(
  text: string,
  fieldPath: string,
  islSources: IslNumberSource[],
  corrections: NumberCorrection[]
): string {
  if (!text) return text;

  // Match numbers with optional % suffix
  // Don't consume trailing whitespace unless followed by %
  const regex = /(-?\d+(?:\.\d+)?)(\s*%)?/g;
  let result = text;
  let offset = 0;

  let match;
  // Reset regex state
  regex.lastIndex = 0;

  // Collect all matches first to avoid mutation issues
  const matches: Array<{ index: number; fullMatch: string; numStr: string; hasPercent: boolean }> = [];
  while ((match = regex.exec(text)) !== null) {
    // Skip ordinals
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 2);
    if (/^(st|nd|rd|th)/i.test(after)) continue;

    matches.push({
      index: match.index,
      fullMatch: match[0],
      numStr: match[1],
      hasPercent: match[2]?.includes('%') ?? false,
    });
  }

  // Process matches in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const num = parseFloat(m.numStr);
    if (!Number.isFinite(num)) continue;

    const correction = findCorrection(num, m.hasPercent, islSources);
    if (correction) {
      const { correctedText, islSource, islValue, driftPercent } = correction;

      corrections.push({
        field: fieldPath,
        original_text: m.fullMatch,
        corrected_text: correctedText,
        isl_source: islSource,
        isl_value: islValue,
        drift_percent: driftPercent,
      });

      // Replace in result
      result = result.slice(0, m.index + offset) + correctedText + result.slice(m.index + offset + m.fullMatch.length);
      offset += correctedText.length - m.fullMatch.length;
    }
  }

  // Re-sort corrections by field for consistency
  corrections.sort((a, b) => a.field.localeCompare(b.field));

  return result;
}

/**
 * Find if a number needs correction and what to correct it to.
 */
function findCorrection(
  extractedNum: number,
  hasPercent: boolean,
  islSources: IslNumberSource[]
): { correctedText: string; islSource: string; islValue: number; driftPercent: number } | null {
  let bestMatch: IslNumberSource | null = null;
  let bestDrift = Infinity;
  let matchedAsPercentage = false;

  for (const source of islSources) {
    // Try direct match
    const directDrift = calculateDrift(extractedNum, source.value);

    // Try percentage interpretation (extracted 74 vs ISL 0.74)
    const percentDrift = source.isPercentage
      ? calculateDrift(extractedNum, source.value * 100)
      : Infinity;

    // Try decimal interpretation (extracted 0.74 vs ISL 74)
    const decimalDrift = source.isPercentage
      ? calculateDrift(extractedNum, source.value)
      : Infinity;

    // Find best match for this source
    let thisDrift = directDrift;
    let asPercentage = false;

    if (percentDrift < thisDrift) {
      thisDrift = percentDrift;
      asPercentage = true;
    }
    if (decimalDrift < thisDrift) {
      thisDrift = decimalDrift;
      asPercentage = false;
    }

    if (thisDrift < bestDrift) {
      bestDrift = thisDrift;
      bestMatch = source;
      matchedAsPercentage = asPercentage;
    }
  }

  // Check if drift is in correctable range (10-25%)
  if (!bestMatch || bestDrift <= MIN_DRIFT_THRESHOLD || bestDrift > MAX_DRIFT_THRESHOLD) {
    return null;
  }

  // Format corrected text
  const correctedText = formatCorrectedNumber(
    bestMatch.value,
    hasPercent,
    matchedAsPercentage,
    bestMatch.isPercentage
  );

  return {
    correctedText,
    islSource: bestMatch.source,
    islValue: bestMatch.value,
    driftPercent: Math.round(bestDrift * 100),
  };
}

/**
 * Calculate drift between two numbers (as fraction).
 */
function calculateDrift(extracted: number, reference: number): number {
  if (reference === 0) {
    return extracted === 0 ? 0 : Infinity;
  }
  return Math.abs(extracted - reference) / Math.abs(reference);
}

/**
 * Format corrected number preserving original format.
 */
function formatCorrectedNumber(
  islValue: number,
  originalHasPercent: boolean,
  matchedAsPercentage: boolean,
  islIsPercentage: boolean
): string {
  if (originalHasPercent) {
    // Original was percentage like "74%"
    // Convert ISL value to percentage and round to integer
    const percentValue = islIsPercentage ? islValue * 100 : islValue;
    return `${Math.round(percentValue)}%`;
  } else if (matchedAsPercentage) {
    // Original was a bare number that matched a percentage (e.g., "74" matching 0.74)
    const percentValue = islIsPercentage ? islValue * 100 : islValue;
    return `${Math.round(percentValue)}`;
  } else {
    // Original was decimal like "0.74"
    // Preserve decimal format with 1-2 decimal places
    if (islValue >= 1 || islValue <= -1) {
      return islValue.toFixed(1);
    } else {
      return islValue.toFixed(2);
    }
  }
}

/**
 * Check if a field path is classified as grounded.
 */
function isGroundedField(fieldPath: string): boolean {
  return M1_REVIEW_GROUNDING_MAP[fieldPath] === 'grounded';
}
