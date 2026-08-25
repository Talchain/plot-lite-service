/**
 * Intervention Normaliser
 *
 * Normalises intervention values to [0,1] before ISL calls and denormalises
 * outcome values back to user units after ISL responses.
 *
 * Problem: ISL expects normalised [0,1] inputs but receives raw values (e.g., $180,000)
 * causing catastrophic outcome predictions.
 *
 * Solution: Scale interventions to [0,1] using node state_space ranges, then
 * inverse-transform ISL outcomes back to user units.
 *
 * @see Schema v2.6 §B.8 - Range derivation priority chain
 */

import type { EngineNodeV3, OptionV3, InterventionValueV3, RepairRecord } from '../types/engine-v3.js';
import { finiteNum } from '../util/numeric.js';
import {
  PERCENT_UNIT_TOKENS,
  canonicaliseUnit,
  classifyUnitCompatibility,
  type ConstraintUnitMismatch,
} from './constraint-units.js';

export type { ConstraintUnitMismatch } from './constraint-units.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Range source for normalisation.
 * Priority order (interventions): explicit_cap > explicit > extracted > inferred_spread > inferred_baseline > inferred_value > default
 *
 * Constraint-only sources (P0-C1, producer-declared scales — see
 * normaliseGoalConstraints):
 * - 'goal_threshold_cap': the node's CEE-stamped goal_threshold_cap
 * - 'unit_percent': the constraint's '%' unit (house doctrine: '%' always
 *   normalises against 100)
 */
export type RangeSource = 'explicit_cap' | 'explicit' | 'extracted' | 'inferred_spread' | 'inferred_baseline' | 'inferred_value' | 'default' | 'goal_threshold_cap' | 'unit_percent';

/**
 * Range for normalisation.
 */
export interface NormalisationRange {
  min: number;
  max: number;
  source: RangeSource;
}

/**
 * True iff `r` is the IDENTITY range `[0,1]`. Doctrine-load-bearing: an identity
 * intervention scale is the marker for "this scale is an ASSUMPTION, not a
 * MEASURED spread" — the node was intervened while Phase 4a was SKIPPED (all
 * interventions already in [0,1]). A NON-identity range is a measured
 * ground-truth spread. The two rank very differently in the constraint priority
 * ladder (identity is demoted below producer declarations). Ignores `source` —
 * only the numeric bounds decide.
 */
export function isIdentityRange(r: NormalisationRange): boolean {
  return r.min === 0 && r.max === 1;
}

/**
 * True iff two ranges are the SAME scale — equal numeric bounds. Source-agnostic
 * by design (A3 R1): "equal bounds = same scale" — a measured intervention spread
 * `[0, cap]` and a producer `goal_threshold_cap` `[0, cap]` describe the identical
 * scale even though their `source` strings differ, so the threshold IS on the
 * samples' scale and did NOT diverge. Compares min AND max by value.
 */
export function rangesEqual(a: NormalisationRange, b: NormalisationRange): boolean {
  return a.min === b.min && a.max === b.max;
}

/**
 * Intervention hints from CE (Context Engine).
 * Used to provide additional metadata for normalisation.
 */
export interface InterventionHints {
  /** Unit of measurement (e.g., "USD", "percent") */
  unit?: string;
  /** Factor type hint (e.g., "salary", "probability") */
  factor_type?: string;
  /** CE-extracted range bounds */
  extracted_range?: [number, number];
  /** Source of the intervention */
  source?: 'brief_extraction' | 'user_specified' | 'inferred';
}

/**
 * Intervention transform record for repairs_applied[].
 * Captures the normalisation transform for auditability.
 */
export interface InterventionTransformRecord {
  factor_id: string;
  raw: number;
  normalised: number;
  range: { min: number; max: number };
  range_source: RangeSource;
}

/**
 * Context for a single factor's normalisation.
 */
export interface FactorNormalisationContext {
  factor_id: string;
  range: NormalisationRange;
  /** Original baseline value (for outcome denormalisation) */
  baseline: number;
}

/**
 * Full normalisation context for a request.
 * Contains all factor contexts needed for normalisation/denormalisation.
 */
export interface NormalisationContext {
  factors: Map<string, FactorNormalisationContext>;
  /** Goal node ID (for outcome denormalisation) */
  goal_node_id: string;
  /** Goal node context (if available) */
  goal_context?: FactorNormalisationContext;
}

/**
 * Normalised options ready for ISL.
 */
export interface NormalisedOptions {
  options: OptionV3[];
  context: NormalisationContext;
}

/**
 * Diagnostic info for a normalised intervention.
 */
export interface NormalisationDiagnostic {
  /**
   * Which option this intervention belongs to. Lets a per-option clamp map
   * be derived (Map<optionId, Map<factorId, clamped>>) so egress can flag a
   * clamped breach magnitude as a lower bound (constraint_margins
   * margin_precision). The push is inside options.map(option => …) where
   * option.id is in scope.
   */
  option_id: string;
  factor_id: string;
  original_value: number;
  normalised_value: number;
  range: NormalisationRange;
  clamped: boolean;
}

// -----------------------------------------------------------------------------
// Range Derivation (Priority Chain per Schema v2.6 §B.8)
// -----------------------------------------------------------------------------

/**
 * A range is usable for (de)normalisation ONLY when both endpoints are finite
 * AND the width is finite and strictly positive (Codex F14). The half-open
 * check `max > min` is NOT sufficient: `{min:-1e308,max:1e308}` satisfies it,
 * yet `max - min === Infinity`, so denormalising a valid `0.5` returns
 * `Infinity` — which `JSON.stringify` emits as a fabricated `null` on the wire,
 * or (for edge current_mean/flip_mean) makes PLoT silently DROP the whole
 * E-value. Every range source is gated through this so a non-finite-width range
 * can never reach `denormaliseValue`; a rejected source falls through the
 * priority chain to the safe `default [0,1]`.
 */
/**
 * THE clamp DIRECTION derivation — one implementation, two call sites.
 *
 * A clamped value was pinned to an endpoint of the normalised domain, and the
 * direction is read back from where it landed: `0` is the floor, `1` the
 * ceiling. Anything strictly between the two is INDETERMINATE and returns
 * `undefined`, which callers must treat as "make no precision claim" rather
 * than as a default direction.
 *
 * ⚠ WHY THIS IS A FUNCTION AND NOT TWO INLINE TERNARIES. It was exactly that:
 * `routes/v2/run.ts` carried two copies — one for the CONSTRAINT threshold
 * clamp, one for the per-option INTERVENTION clamp — written in OPPOSITE
 * operand order (`<= 0` first in one, `>= 1` first in the other). They were
 * equivalent, but a hand-maintained mirror is this estate's dominant defect
 * and the two would eventually disagree. Worse, a TEST helper wrote a THIRD
 * copy that collapsed the `undefined` branch into `'high'`, making the test
 * oracle MORE protective than production — so a near-boundary case passed in
 * test while production shipped the opposite verdict. A shared function is
 * what stops a test certifying a cell it does not exercise.
 *
 * Order of the two comparisons is immaterial: a value cannot be both `<= 0`
 * and `>= 1`. A non-finite value satisfies neither and therefore returns
 * `undefined` — fail-closed, no claim.
 *
 * @param normalisedValue the POST-clamp value recorded on the diagnostic
 */
export function deriveClampDirection(
  normalisedValue: number,
): 'low' | 'high' | undefined {
  if (normalisedValue <= 0) return 'low';
  if (normalisedValue >= 1) return 'high';
  return undefined;
}

export function isFiniteRange(min: number, max: number): boolean {
  return (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    Number.isFinite(max - min) &&
    max - min > 0
  );
}

/**
 * Validate an extracted range from CE.
 * Returns true if the range is valid for normalisation.
 */
function isValidExtractedRange(range: [number, number] | undefined): range is [number, number] {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [min, max] = range;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  // F14: require finite endpoints AND a finite positive width (min<max alone
  // admits {-1e308,1e308} whose width overflows to Infinity).
  if (!isFiniteRange(min, max)) return false;
  return true;
}

/**
 * Derive normalisation range for a factor node.
 *
 * 7-tier priority chain (per Schema v2.6 §B.8, extended):
 *
 * | Priority | Source label       | Formula / Rule                                            |
 * |----------|--------------------|-----------------------------------------------------------|
 * | 0        | `explicit_cap`     | `observed_state.cap` (CEE-set authoritative scale cap).   |
 * |          |                    | Range: [0, cap]. Requires cap > 0.                       |
 * | 1        | `explicit`         | `state_space.range` (user-confirmed). Requires max > min. |
 * | 1.5      | `extracted`        | `intervention_hints.extracted_range` from CE extraction.  |
 * | 1.75     | `inferred_spread`  | min/max of intervention values across options + 20%       |
 * |          |                    | padding. Requires ≥2 values with variation.               |
 * |          |                    | Outlier guard: skipped if maxVal > minVal × 100.          |
 * |          |                    | Lower bound clamped to 0 when all values non-negative.    |
 * | 2        | `inferred_baseline`| `[min(0,2b,2v), max(0,2b,2v)]` over baseline b and (when   |
 * |          |                    | finite) current value v. Sign-preserving AND CONTAINS     |
 * |          |                    | BOTH (D-9): opposite-sign b/v both round-trip (e.g.       |
 * |          |                    | b=-500,v=+600 → `[-1000,1200]`). Same-sign/single reduces |
 * |          |                    | to `[0,2r]` (r≥0) / `[2r,0]` (r<0), unchanged.            |
 * | 3        | `inferred_value`   | `[min(0,2v), max(0,2v)]`, sign-preserving (D-9). Falls    |
 * |          |                    | through if value is 0.                                    |
 * | 4        | `default`          | `[0, 1]`. Used when value is 0, missing, or unavailable.  |
 *
 * @param node Factor node
 * @param hints Optional intervention hints from CE
 * @param interventionValues Optional array of intervention values for this factor across options
 * @returns Normalisation range with source indicator (see RangeSource type)
 */
export function deriveRange(
  node: EngineNodeV3,
  hints?: InterventionHints,
  interventionValues?: number[]
): NormalisationRange {
  const stateSpace = node.state_space;
  const observedState = node.observed_state;

  // Priority 0: Explicit cap from observed_state
  // Authoritative scale cap set by CEE (e.g., goal node with cap=1000 means value=200 → 0.2).
  // Takes precedence over state_space.range to ensure consistent normalisation
  // across both intervention (Phase 4a) and constraint (Phase 4b) paths.
  // F14: require a finite positive width at every source (isFiniteRange) so an
  // overflow-width range can never reach denormaliseValue — a rejected source
  // falls through to the next priority (ultimately the safe default [0,1]).
  if (typeof observedState?.cap === 'number' && observedState.cap > 0 && isFiniteRange(0, observedState.cap)) {
    return { min: 0, max: observedState.cap, source: 'explicit_cap' };
  }

  // Priority 1: Explicit state_space.range
  if (stateSpace?.range) {
    const { min, max } = stateSpace.range;
    if (typeof min === 'number' && typeof max === 'number' && isFiniteRange(min, max)) {
      return { min, max, source: 'explicit' };
    }
  }

  // Priority 1.5: CE extracted_range (from intervention_hints)
  if (hints && isValidExtractedRange(hints.extracted_range)) {
    const [min, max] = hints.extracted_range;
    return { min, max, source: 'extracted' };
  }

  // Priority 1.75: Intervention spread across options
  // Requires ≥2 intervention values to compute meaningful spread
  if (interventionValues && interventionValues.length >= 2) {
    // Sort values for consistent min/max calculation regardless of input order
    const sorted = interventionValues.slice().sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[sorted.length - 1];
    const spread = maxVal - minVal;

    // Only use spread if there's actual variation
    if (spread > 0) {
      // Outlier guard: skip spread if ratio is extreme (likely extraction error)
      // e.g., one option has £50k, another has £5m due to LLM hallucination
      if (minVal > 0 && maxVal > minVal * 100) {
        // Fall through to baseline/value inference
        // Extreme ratio detected - spread range would be unreliable
      } else {
        const padding = spread * 0.2;
        // Clamp lower bound to 0 when all intervention values are non-negative
        const paddedMin = minVal >= 0 ? Math.max(0, minVal - padding) : minVal - padding;
        const paddedMax = maxVal + padding;
        // F14: skip an overflow-width spread (e.g. values near ±1e308) — fall
        // through to baseline/value inference or the default.
        if (isFiniteRange(paddedMin, paddedMax)) {
          return { min: paddedMin, max: paddedMax, source: 'inferred_spread' };
        }
      }
    }
  }

  // Get current value and baseline
  const currentValue = observedState?.value;
  const baseline = observedState?.baseline;

  // Priority 2: Inferred from baseline and current value
  if (baseline !== undefined && typeof baseline === 'number') {
    // D-9 (CONTAIN BOTH, sign-preserving): the derived range must CONTAIN 0 AND
    // both the (doubled) baseline and the (doubled) current value, so a
    // negative-domain factor round-trips instead of clamping to 0 — AND an
    // OPPOSITE-SIGN baseline/currentValue pair (e.g. baseline=-500,
    // currentValue=+600) yields a range containing BOTH (-1000..1200), not just
    // the larger-magnitude one ({0,1200}, which erased -500). The earlier
    // larger-magnitude single-`ref` logic was incomplete for mixed signs.
    //   candidates = [0, 2·baseline] (+ 2·currentValue when finite)
    //   range = [min(candidates), max(candidates)]
    // Reduces to the prior behaviour for the same-sign / single-value cases:
    //   both ≥ 0 → [0, 2·max] · both < 0 → [2·min, 0] · single r → [min(0,2r), max(0,2r)]
    // (zero delta for positive-domain factors; unchanged for both-negative and
    // single-value). A baseline=0 with no currentValue collapses to {0,0} and
    // falls through to Priority 3/4 exactly as before (isFiniteRange width guard).
    const candidates = [0, 2 * baseline];
    if (currentValue !== undefined && Number.isFinite(currentValue)) {
      candidates.push(2 * currentValue);
    }
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    // F14: only a finite POSITIVE-width range is usable (also rejects the {0,0}
    // baseline=0 no-currentValue collapse); fall through to value / default.
    if (isFiniteRange(min, max)) return { min, max, source: 'inferred_baseline' };
  }

  // Priority 3: Inferred from current value only
  if (currentValue !== undefined && typeof currentValue === 'number' && currentValue !== 0) {
    // D-9 (PRESERVE SIGN): range = [min(0,2v), max(0,2v)] — [0,2v] for v>0
    // (identical to the previous {0, 2×|v|}, zero delta for positive factors)
    // and [2v,0] for v<0 (e.g. v=-500 → {-1000,0}, so -500 → ~0.5 not clamp-to-0).
    const doubled = 2 * currentValue;
    const min = Math.min(0, doubled);
    const max = Math.max(0, doubled);
    // F14: skip an overflow-width inferred range; fall through to the default.
    if (isFiniteRange(min, max)) return { min, max, source: 'inferred_value' };
  }

  // Priority 4: Default [0, 1]
  return { min: 0, max: 1, source: 'default' };
}

// -----------------------------------------------------------------------------
// Normalisation Functions
// -----------------------------------------------------------------------------

/**
 * Normalise a value to [0, 1] given a range.
 *
 * Formula: normalised = (value - min) / (max - min)
 *
 * Edge cases:
 * - Zero-width range (min == max): return 0.5 (midpoint)
 * - Value outside range: clamp to [0, 1]
 *
 * ABSENCE IN ⇒ ABSENCE OUT (ROADMAP 1.278). The parameter is `unknown` and the
 * return is `… | undefined` **on purpose** — the ingress side of the same
 * fabricate-on-absence class ROADMAP 1.277 closed on `denormaliseValue`, and
 * deliberately given the SAME shape so a reader of this file does not have to
 * remember which of the two adjacent primitives self-guards.
 *
 * The signature used to be `(value: number, …)`, and that `number` was a
 * compile-time fiction: `interventions` arrives through an Ajv schema that types
 * the CONTAINER only (`{ type: 'object' }`), so the values were never validated
 * against it. `null` therefore reached the arithmetic and coerced to 0:
 *
 *     normaliseValue(null, { min: 10, max: 20 })  → { normalised: 0, clamped: true  }
 *     normaliseValue(null, { min: 0,  max: 200 }) → { normalised: 0, clamped: false }
 *
 * i.e. an unspecified intervention silently became **"intervene at the range
 * minimum"** — a different question, answered confidently — and on a min-0 range
 * it was not even flagged as clamped. `clamped` is the only signal this struct
 * carries about a suspect input, and the SILENT case is precisely the one where
 * a caller could have noticed.
 *
 * Note the asymmetry that hid it: `undefined`, a missing key and a non-numeric
 * string all produce `NaN` here, which downstream finiteness checks reject — so
 * absence tests written with those shapes passed, while `null`, the shape the
 * wire actually carries, produced a plausible finite number. `NaN` was in fact
 * asserted as a DELIBERATELY UNGUARDED SEAM by
 * tests/gates/numeric-safety-deep-scan.test.ts; that assertion is updated in
 * this slice, because the seam is now closed.
 *
 * @param value Raw value to normalise — UNTRUSTED; may be any wire shape
 * @param range Normalisation range
 * @returns `{ normalised, clamped }`, or `undefined` if `value` was not a finite
 *          number (absent / null / NaN / ±Infinity / non-numeric)
 */
export function normaliseValue(
  value: unknown,
  range: NormalisationRange,
): { normalised: number; clamped: boolean } | undefined {
  // Absence in ⇒ absence out. Never arithmetic on a non-number: `null` coerces
  // to 0 and manufactures the range minimum as a plausible intervention.
  const v = finiteNum(value);
  if (v === undefined) return undefined;

  return normaliseFiniteValue(v, range);
}

function normaliseFiniteValue(value: number, range: NormalisationRange): { normalised: number; clamped: boolean } {
  const { min, max } = range;
  const rangeWidth = max - min;

  // Edge case: zero-width range
  if (rangeWidth <= 0) {
    // If value equals the single point, return 0.5 (midpoint of [0,1])
    // Otherwise, use value / max if max > 0, else 0
    if (max > 0) {
      const normalised = Math.min(1, Math.max(0, value / max));
      return { normalised, clamped: value !== max };
    }
    return { normalised: 0.5, clamped: false };
  }

  // Standard normalisation
  const raw = (value - min) / rangeWidth;

  // Clamp to [0, 1]
  const clamped = raw < 0 || raw > 1;
  const normalised = Math.min(1, Math.max(0, raw));

  return { normalised, clamped };
}

/**
 * Denormalise a value from [0, 1] back to original units.
 *
 * Formula: original = normalised × (max - min) + min
 *
 * ABSENCE IN ⇒ ABSENCE OUT (ROADMAP 1.277). The parameter is `unknown` and the
 * return is `number | undefined` **on purpose**. This is the fabricate-on-absence
 * class closed at the PRIMITIVE rather than at ~15 call sites' vigilance.
 *
 * The signature used to be `(normalised: number, …): number`, and that `number`
 * was a compile-time fiction over `as`-cast wire data: PLoT parses every ISL
 * response with `JSON.parse(text) as T` (src/integrations/isl/client.ts:245) —
 * no runtime validation — and ISL measurably emits `null` for absent nested
 * numerics (`exclude_none=True` does not reach inside nested objects; same wire
 * fact recorded on ISLOptionResult below). So `null` reached the arithmetic:
 *
 *     denormaliseValue(null, { min: 10, max: 20 })
 *       === null * 10 + 10
 *       === 10                     // the RANGE FLOOR
 *
 * and `Number.isFinite(10)` is **true**. An outcome ISL never computed was
 * therefore published as a precise, confident measurement sitting exactly at the
 * bottom of the goal range — "this option achieves the worst possible result" —
 * and it was INVISIBLE to every post-hoc finiteness check, because a post-hoc
 * check cannot distinguish a fabricated finite number from a measured one.
 * This exact mechanism shipped a live defect once already (#278 /
 * denormaliseOptionResult, documented below); ROADMAP 1.277 closes it at the
 * source so it cannot recur through a new caller.
 *
 * Note the asymmetry that hid it, and why a `number` parameter was worse than
 * useless: `undefined` and a missing key both produce `NaN` here, which every
 * egress guard already rejects — so absence tests written with those two shapes
 * passed while the shape the wire actually carries (`null`) sailed through.
 *
 * `finiteNum` rejects null/undefined/NaN/±Infinity, so only a real measurement
 * reaches the arithmetic and an absent one stays absent. A valid value passes
 * through byte-identically (`finiteNum` neither clamps nor coerces).
 *
 * @param normalised Normalised value in [0, 1] — UNTRUSTED; may be any wire shape
 * @param range Original normalisation range
 * @returns Denormalised value in original units, or `undefined` if `normalised`
 *          was not a finite number (absent / null / NaN / ±Infinity)
 */
export function denormaliseValue(normalised: unknown, range: NormalisationRange): number | undefined {
  // Absence in ⇒ absence out. Never arithmetic on a non-number: `null` coerces
  // to 0 and manufactures the range floor as a plausible measurement.
  const n = finiteNum(normalised);
  if (n === undefined) return undefined;

  const { min, max } = range;
  const rangeWidth = max - min;

  // Edge case: zero-width range
  if (rangeWidth <= 0) {
    // Return the single point
    return max;
  }

  return n * rangeWidth + min;
}

// -----------------------------------------------------------------------------
// Context Building
// -----------------------------------------------------------------------------

/**
 * Collect intervention values per factor from all options.
 * Returns a map of factor ID to array of intervention values.
 */
function collectInterventionValues(options: OptionV3[]): Map<string, number[]> {
  const valuesByFactor = new Map<string, number[]>();

  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const existing = valuesByFactor.get(factorId) ?? [];
      existing.push(intervention.value);
      valuesByFactor.set(factorId, existing);
    }
  }

  return valuesByFactor;
}

/**
 * Build normalisation context from graph nodes.
 *
 * Creates contexts for all factor nodes that might be intervention targets
 * or the goal node.
 *
 * @param nodes Graph nodes
 * @param goalNodeId Goal node ID
 * @param interventionHints Optional map of factor ID to intervention hints from CE
 * @param options Optional options array for intervention spread calculation
 * @returns Normalisation context
 */
export function buildNormalisationContext(
  nodes: EngineNodeV3[],
  goalNodeId: string,
  interventionHints?: Map<string, InterventionHints>,
  options?: OptionV3[]
): NormalisationContext {
  const factors = new Map<string, FactorNormalisationContext>();
  let goalContext: FactorNormalisationContext | undefined;

  // Collect intervention values per factor for spread calculation
  const interventionValuesByFactor = options ? collectInterventionValues(options) : new Map();

  for (const node of nodes) {
    // Only build context for factors and the goal node
    // Skip non-causal nodes (option, decision, etc.) to avoid spurious normalisation
    const isGoalNode = node.id === goalNodeId;
    const isFactorNode = node.kind === 'factor';

    if (!isGoalNode && !isFactorNode) {
      continue;
    }

    // Get hints for this factor if available
    const hints = interventionHints?.get(node.id);
    // Get intervention values for spread calculation
    const interventionValues = interventionValuesByFactor.get(node.id);
    const range = deriveRange(node, hints, interventionValues);
    const baseline = node.observed_state?.baseline ?? node.observed_state?.value ?? 0;

    const context: FactorNormalisationContext = {
      factor_id: node.id,
      range,
      baseline,
    };

    factors.set(node.id, context);

    // Track goal node context separately for outcome denormalisation
    if (isGoalNode) {
      goalContext = context;
    }
  }

  return {
    factors,
    goal_node_id: goalNodeId,
    goal_context: goalContext,
  };
}

// -----------------------------------------------------------------------------
// Option Normalisation
// -----------------------------------------------------------------------------

/**
 * Build fallback ranges from intervention values for factors without context.
 *
 * When a factor has no normalisation context (no observed_state, no state_space.range),
 * we derive a range from the intervention values themselves to avoid collapsing
 * distinct values to the same normalised result.
 *
 * Range: [0, 2 × max(|intervention values|)]
 *
 * @param options Options with intervention values
 * @param context Existing normalisation context
 * @returns Map of factor ID to inferred range
 */
function buildFallbackRanges(
  options: OptionV3[],
  context: NormalisationContext
): Map<string, NormalisationRange> {
  // Collect all intervention values by factor ID
  const valuesByFactor = new Map<string, number[]>();

  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      // Only collect for factors without existing context
      if (!context.factors.has(factorId)) {
        const existing = valuesByFactor.get(factorId) ?? [];
        existing.push(intervention.value);
        valuesByFactor.set(factorId, existing);
      }
    }
  }

  // Build ranges from collected values
  const fallbackRanges = new Map<string, NormalisationRange>();

  for (const [factorId, values] of valuesByFactor) {
    // Use spread formula when ≥2 values with actual variation
    if (values.length >= 2) {
      // Sort values for consistent min/max calculation regardless of input order
      const sorted = values.slice().sort((a, b) => a - b);
      const minVal = sorted[0];
      const maxVal = sorted[sorted.length - 1];
      const spread = maxVal - minVal;

      if (spread > 0) {
        // Outlier guard: skip spread if ratio is extreme (likely extraction error)
        const isOutlier = minVal > 0 && maxVal > minVal * 100;
        if (!isOutlier) {
          const padding = spread * 0.2;
          // Clamp lower bound to 0 when all values are non-negative
          const paddedMin = minVal >= 0 ? Math.max(0, minVal - padding) : minVal - padding;
          const paddedMax = maxVal + padding;
          // F14: skip an overflow-width spread; fall through to the [0, 2×max]
          // fallback or the default [0,1] below.
          if (isFiniteRange(paddedMin, paddedMax)) {
            fallbackRanges.set(factorId, { min: paddedMin, max: paddedMax, source: 'inferred_spread' });
            continue;
          }
        }
        // Fall through to default range on extreme outlier / overflow
      }
    }

    // Fallback for single value, zero spread, or extreme outlier: [0, 2 × max(|values|)]
    const maxAbsValue = Math.max(...values.map(Math.abs));

    if (maxAbsValue > 0 && isFiniteRange(0, 2 * maxAbsValue)) {
      // Range: [0, 2 × max(|values|)] - ensures all values fit with headroom
      fallbackRanges.set(factorId, {
        min: 0,
        max: 2 * maxAbsValue,
        source: 'default', // Still 'default' source but with meaningful range
      });
    } else {
      // All values are zero, or an overflow-width inference (F14) — use [0, 1]
      fallbackRanges.set(factorId, { min: 0, max: 1, source: 'default' });
    }
  }

  return fallbackRanges;
}

/**
 * Round a number to 6 decimal places for stable diffs.
 */
function roundTo6Decimals(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Format reason string for intervention normalisation.
 * Format: "normalised range=[{min},{max}] source={range_source}"
 */
function formatNormalisationReason(range: NormalisationRange): string {
  const min = roundTo6Decimals(range.min);
  const max = roundTo6Decimals(range.max);
  return `normalised range=[${min},${max}] source=${range.source}`;
}

/**
 * Normalise all intervention values in options.
 *
 * When factors lack normalisation context (no observed_state, no state_space.range),
 * ranges are inferred from the intervention values themselves to ensure distinct
 * values produce distinct normalised results.
 *
 * @param options Original options with raw intervention values
 * @param context Normalisation context
 * @returns Normalised options, diagnostics, transforms, and repair records
 */
export function normaliseOptions(
  options: OptionV3[],
  context: NormalisationContext
): {
  options: OptionV3[];
  diagnostics: NormalisationDiagnostic[];
  transforms: Map<string, InterventionTransformRecord>;
  repairs: RepairRecord[];
} {
  const diagnostics: NormalisationDiagnostic[] = [];

  // Track transforms by factor ID (for deduplication)
  // Key: factor_id, Value: transform record
  const transforms = new Map<string, InterventionTransformRecord>();

  // Track first raw value seen for each factor (for repair records)
  const firstRawValueByFactor = new Map<string, number>();

  // Build fallback ranges for factors without context
  const fallbackRanges = buildFallbackRanges(options, context);

  const normalisedOptions: OptionV3[] = options.map(option => {
    const normalisedInterventions: Record<string, InterventionValueV3> = {};

    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const factorContext = context.factors.get(factorId);

      // Determine which range to use
      const range: NormalisationRange = factorContext
        ? factorContext.range
        : fallbackRanges.get(factorId) ?? { min: 0, max: 1, source: 'default' };

      // ROADMAP 1.278 — explicit absence handling. `InterventionValueV3.value`
      // is a REQUIRED number, so there is no honest way to represent absence in
      // the normalised output: omitting the entry would silently change WHAT WAS
      // ANALYSED while still returning a confident answer (the worse failure),
      // and substituting any number fabricates. The only non-fabricating
      // disposal is to refuse.
      //
      // REACHABILITY: unreachable from the wire. POST /v2/run rejects a
      // non-finite intervention value at the Phase 1a++ ingress guard
      // (422 INVALID_INTERVENTION_VALUE) before this runs, and that guard shares
      // its predicate with normalizeInterventions(). This throw is
      // defence-in-depth for a FUTURE in-process caller, and it converts a
      // silent fabrication into a loud, precisely-named failure.
      const normalisation = normaliseValue(intervention.value, range);
      if (normalisation === undefined) {
        throw new Error(
          `normaliseOptions: non-finite intervention value for option '${option.id}' factor '${factorId}' ` +
          `(received ${JSON.stringify(intervention.value) ?? 'undefined'}). ` +
          `Intervention values must be validated at the request boundary before normalisation.`,
        );
      }
      const { normalised, clamped } = normalisation;

      normalisedInterventions[factorId] = {
        value: normalised,
        source: intervention.source,
      };

      diagnostics.push({
        option_id: option.id,
        factor_id: factorId,
        original_value: intervention.value,
        normalised_value: normalised,
        range,
        clamped,
      });

      // Track first raw value for this factor (for deduplicated repair record)
      if (!firstRawValueByFactor.has(factorId)) {
        firstRawValueByFactor.set(factorId, intervention.value);
      }

      // Only create one transform record per factor (dedupe by factor_id)
      if (!transforms.has(factorId)) {
        transforms.set(factorId, {
          factor_id: factorId,
          raw: roundTo6Decimals(intervention.value),
          normalised: roundTo6Decimals(normalised),
          range: { min: roundTo6Decimals(range.min), max: roundTo6Decimals(range.max) },
          range_source: range.source,
        });
      }
    }

    return {
      id: option.id,
      label: option.label,
      interventions: normalisedInterventions,
    };
  });

  // Build repair records from transforms (one per factor)
  // Include factor_id in field name for traceability: "intervention.value.{factor_id}"
  const repairs: RepairRecord[] = Array.from(transforms.values()).map(transform => ({
    field: `intervention.value.${transform.factor_id}`,
    action: 'normalised' as const,
    from_value: transform.raw,
    to_value: transform.normalised,
    reason: formatNormalisationReason({
      min: transform.range.min,
      max: transform.range.max,
      source: transform.range_source,
    }),
  }));

  return { options: normalisedOptions, diagnostics, transforms, repairs };
}

// -----------------------------------------------------------------------------
// Full Request/Response Transformation
// -----------------------------------------------------------------------------

/**
 * Full result from normaliseOptionsForISL including repair records.
 */
export interface NormalisationResult {
  options: OptionV3[];
  context: NormalisationContext;
  diagnostics: NormalisationDiagnostic[];
  /** Intervention transforms by factor ID */
  transforms: Map<string, InterventionTransformRecord>;
  /** Repair records for _meta.repairs_applied (one per factor) */
  repairs: RepairRecord[];
}

/**
 * Normalise options for ISL call.
 *
 * Entry point for normalisation. Returns normalised options and context
 * needed for later denormalisation of outcomes.
 *
 * @param options Original options with raw intervention values
 * @param nodes Graph nodes (for building normalisation context)
 * @param goalNodeId Goal node ID
 * @param interventionHints Optional map of factor ID to intervention hints from CE
 * @returns Normalised options, context, diagnostics, transforms, and repair records
 */
export function normaliseOptionsForISL(
  options: OptionV3[],
  nodes: EngineNodeV3[],
  goalNodeId: string,
  interventionHints?: Map<string, InterventionHints>
): NormalisationResult {
  // Pass options to context builder for intervention spread calculation
  const context = buildNormalisationContext(nodes, goalNodeId, interventionHints, options);
  const { options: normalisedOptions, diagnostics, transforms, repairs } = normaliseOptions(options, context);

  return {
    options: normalisedOptions,
    context,
    diagnostics,
    transforms,
    repairs,
  };
}

/**
 * Check if normalisation is needed for the given options.
 *
 * Returns true if any intervention value is outside [0, 1].
 * This allows skipping normalisation when values are already normalised.
 *
 * @param options Options to check
 * @returns True if normalisation is needed
 */
export function needsNormalisation(options: OptionV3[]): boolean {
  for (const option of options) {
    for (const intervention of Object.values(option.interventions)) {
      const value = intervention.value;
      if (value < 0 || value > 1) {
        return true;
      }
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// ISL Result Denormalisation
// -----------------------------------------------------------------------------

/**
 * ISL option result with outcome data.
 * Matches the shape returned by ISL /api/v1/robustness/analyze/v2
 */
/**
 * ISL option result AS IT ARRIVES ON THE WIRE.
 *
 * Every numeric slot is `| null` because that is what the deployed service
 * measurably sends for an absent value (same wire fact recorded for
 * `failure_margin_median` / `near_miss_fraction` in
 * src/integrations/isl/types/isl-types.ts — `exclude_none=True` on the route
 * does not reach inside these nested objects). Declaring them bare `number`
 * was a compile-time fiction over untrusted wire data, and it cost a live
 * defect: see denormaliseOptionResult below.
 *
 * Keep the `| null`. It is what makes `opt.outcome.std * rangeWidth` a type
 * error, so the only way to compute with these values is to validate them
 * first — derived, not remembered.
 */
interface ISLOptionResult {
  option_id?: string;
  id?: string;
  expected_outcome?: number | null;
  confidence_interval?: [number | null, number | null];
  outcome?: {
    mean: number | null;
    std?: number | null;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    n_samples?: number | null;
    n_valid_samples?: number | null;
    validity_ratio?: number | null;
  };
  [key: string]: unknown;
}

/**
 * ISL result shape for robustness analysis.
 */
interface ISLResult {
  options?: ISLOptionResult[];
  results?: ISLOptionResult[]; // V1 compatibility
  [key: string]: unknown;
}

/**
 * Denormalise ISL result outcomes back to user units.
 *
 * Transforms all outcome values (mean, p10, p50, p90, expected_outcome,
 * confidence_interval) from [0,1] back to the goal node's original units.
 *
 * @param islResult ISL result with normalised outcomes
 * @param context Normalisation context (must include goal_context)
 * @returns ISL result with denormalised outcomes (new object, doesn't mutate input)
 */
export function denormaliseISLResult(
  islResult: ISLResult,
  context: NormalisationContext
): ISLResult {
  // No goal context means we can't denormalise
  if (!context.goal_context) {
    return islResult;
  }

  const goalContext = context.goal_context;
  const range = goalContext.range;

  // Clone the result to avoid mutation
  const result: ISLResult = { ...islResult };

  // Process options array (ISL V2 format)
  if (Array.isArray(result.options)) {
    result.options = result.options.map(opt => denormaliseOptionResult(opt, range));
  }

  // Process results array (ISL V1 format)
  if (Array.isArray(result.results)) {
    result.results = result.results.map(opt => denormaliseOptionResult(opt, range));
  }

  return result;
}

/**
 * Denormalise a single option result.
 *
 * VALIDATE BEFORE DENORMALISING (ROADMAP 1.240 — found by the absence-shape
 * arm of tests/gates/numeric-safety-deep-scan.test.ts).
 *
 * This function used to compute unconditionally:
 *
 *     mean: denormaliseValue(opt.outcome.mean, range)   // null → null*w + min
 *     std:  opt.outcome.std !== undefined ? opt.outcome.std * rangeWidth : undefined
 *
 * Both fabricate on the shape ISL actually sends. `denormaliseValue(null, …)`
 * evaluates `null * rangeWidth + min` === `min`, so an outcome ISL did not
 * compute was published as a PRECISE MEASURED OUTCOME sitting exactly at the
 * bottom of the goal range — "this option achieves the worst possible result".
 * And `std !== undefined` is the identical guard #277 removed from
 * buildConstraintFields: `null !== undefined` is true, so `null * rangeWidth`
 * collapsed to a measured standard deviation of 0, i.e. perfect certainty.
 *
 * The fabricated stats are all finite and in range, so every downstream
 * finiteness and range check passed them, `hasAllRequiredOutcomeStats` returned
 * true, and `option_comparison_status` reported a confident 'computed'. This is
 * on the LIVE /v2/run → CEE path.
 *
 * Note the asymmetry that hid it: `undefined` and a MISSING KEY both produce
 * `NaN` here, which the egress guards already reject, so the defect was
 * invisible to every absence test written with those two shapes. Only `null`
 * — the shape the wire actually carries — coerces to a plausible number.
 *
 * `finiteNum` rejects null/undefined/NaN/±Infinity, so only a real measurement
 * reaches the arithmetic and an absent one stays absent.
 */
function denormaliseOptionResult(
  opt: ISLOptionResult,
  range: NormalisationRange
): ISLOptionResult {
  const denormalised: ISLOptionResult = { ...opt };

  /** Denormalise only a genuine measurement; absence stays absent. */
  const dn = (v: unknown): number | undefined => {
    const n = finiteNum(v);
    return n === undefined ? undefined : denormaliseValue(n, range);
  };

  // Denormalise expected_outcome
  const expected = dn(opt.expected_outcome);
  if (expected !== undefined) {
    denormalised.expected_outcome = expected;
  }

  // Denormalise confidence_interval. Both bounds must be measured — half a
  // denormalised interval is not an interval, and substituting one bound
  // manufactures a width.
  if (Array.isArray(opt.confidence_interval) && opt.confidence_interval.length === 2) {
    const lo = dn(opt.confidence_interval[0]);
    const hi = dn(opt.confidence_interval[1]);
    denormalised.confidence_interval = lo !== undefined && hi !== undefined
      ? [lo, hi]
      : undefined;
  }

  // Denormalise full outcome stats
  if (opt.outcome && typeof opt.outcome === 'object') {
    const rangeWidth = range.max - range.min;
    const std = finiteNum(opt.outcome.std);

    denormalised.outcome = {
      ...opt.outcome,
      mean: dn(opt.outcome.mean) ?? null,
      p10: dn(opt.outcome.p10) ?? null,
      p50: dn(opt.outcome.p50) ?? null,
      p90: dn(opt.outcome.p90) ?? null,
      // Scale std by range width — only when std was actually measured.
      std: std !== undefined ? std * rangeWidth : undefined,
    };
  }

  return denormalised;
}

// -----------------------------------------------------------------------------
// Goal Constraint Normalisation
// -----------------------------------------------------------------------------

import type { GoalConstraint } from '../types/engine-v3.js';

/**
 * Normalised goal constraint with original value preserved.
 */
export interface NormalisedGoalConstraint extends GoalConstraint {
  /** Original value in user units (before normalisation) */
  original_value: number;
}

/**
 * Node-level goal-threshold metadata (P0-C1).
 *
 * CEE stamps these on the RAW upstream node (`goal_threshold` already
 * normalised to [0,1], `goal_threshold_cap` = the scale it was normalised
 * against, e.g. 100 for '%'). The canonical EngineNodeV3 does not carry them,
 * so the route captures them from `body.graph.nodes` and passes them in here.
 */
export interface GoalThresholdNodeMeta {
  /** Already-normalised threshold in [0,1], stamped by CEE */
  goal_threshold?: number;
  /** Scale cap the raw user threshold was normalised against (e.g. 100 for '%') */
  goal_threshold_cap?: number;
}

/**
 * Producer-declared scale signals for constraint normalisation (P0-C1).
 * Both are additive/optional — omitting them reproduces the legacy behaviour.
 */
export interface ConstraintNormalisationExtras {
  /**
   * Unit per constraint_id, captured from the raw client/compiled constraints
   * BEFORE the ISL-boundary strip (the temporal filter removes `unit`).
   */
  unitsByConstraintId?: Map<string, string>;
  /** Raw-node goal-threshold metadata per node_id */
  goalThresholdMetaByNodeId?: Map<string, GoalThresholdNodeMeta>;
  /**
   * The EXACT normalisation range each node's INTERVENTIONS were scaled against
   * in Phase 4a (keyed by node_id). This is the scale the ISL samples for that
   * node actually occupy, so the constraint threshold on the same node MUST be
   * normalised against the identical range — otherwise ISL compares a threshold
   * and samples that live on two different scales (the A3 range-split defect:
   * a violated cap scored probability 1; margins were on a phantom width).
   *
   * When present for a node, this range OVERRIDES the constraint-side derivation
   * chain (including producer-declared caps) — see the DOCTRINE-PENDING note in
   * normaliseGoalConstraints. A node whose interventions were forwarded raw
   * ([0,1] gate skipped) is carried here as an identity [0,1] range so the
   * threshold stays on the same raw sample scale rather than being independently
   * re-normalised via a node heuristic.
   */
  interventionScaleByNodeId?: Map<string, NormalisationRange>;
  /**
   * Whether the caller's global `constraintsNeedNormalisation` gate fired. When
   * TRUE (or unset — the default preserves every direct-unit-test caller), a
   * constraint on a node WITHOUT an intervention scale is normalised through the
   * existing derivation chain, exactly as before. When explicitly FALSE, that
   * same constraint is forwarded raw (its value is already in [0,1] by
   * definition of the gate), so only constraints on intervened nodes with a
   * NON-identity scale are transformed. This keeps behaviour byte-identical for
   * constraints on non-intervened nodes across every gate combination.
   */
  normaliseWithoutScale?: boolean;
}

/**
 * True when a constraint unit means "percent" (house doctrine: '%' always
 * normalises against 100).
 *
 * The token list is NOT spelled here: it is `PERCENT_UNIT_TOKENS` in
 * `constraint-units.ts`, which the unit-family map also consumes. Two copies of
 * this vocabulary is exactly the hand-maintained mirror that lets a token be
 * added to one and not the other.
 */
export function isPercentUnit(unit: string | undefined): boolean {
  const u = canonicaliseUnit(unit);
  return u !== undefined && PERCENT_UNIT_TOKENS.includes(u);
}

/**
 * ROADMAP 2.957 — THE PERCENT SCALE IS DECIDED BY THE PRODUCER'S CONVENTION,
 * AND THAT CONVENTION IS MAGNITUDE-DEPENDENT. THIS IS NOT PLoT'S CHOICE.
 *
 * ⚠ READ THE PRODUCER BEFORE CHANGING THIS. A `'%'` constraint does NOT always
 * carry percentage points. CEE's LLM extractor emits **`"4%"` as
 * `value: 0.04, unit: "%"`** — a FRACTION under a `'%'` label — and CEE's own
 * `normaliseConstraintUnits` exists to relabel exactly that case, with a
 * comment naming the opposite reading as the defect it prevents
 * (`olumi-assistants-service/src/cee/compound-goal/extractor.ts:925-934`):
 *
 *     "The LLM extractor converts "4%" to value: 0.04, unit: "%".
 *      If a consumer interprets unit: "%" as "value is percentage points",
 *      0.04% ≠ 4%.  This normaliser detects the fractional case and relabels
 *      the unit to "fraction" so the convention is unambiguous.
 *      Rule: if unit === "%" and 0 < value < 1 → already fractional."
 *
 * It relabels WITHOUT dividing — the value was already fractional. And the
 * relabel is NOT guaranteed to have happened: `normaliseConstraintUnits` is
 * called only on the REGEX-extracted branch
 * (`stages/repair/compound-goals.ts` — the LLM-emitted branch below it does
 * not call it), so a fractional value under a raw `'%'` label reaches PLoT on
 * the primary draft path.
 *
 * THE OTHER HALF OF THE PRODUCER'S RULE, equally load-bearing: a `'%'`
 * constraint whose value is `>= 1` IS percentage points. CEE pins this itself —
 * `tests/unit/cee.constraint-unit-normalisation.test.ts`:
 *   "preserves percentage-unit constraints where value >= 1 (already in pp
 *    form)" · "// value: 4, unit: "%" means "4 percentage points""
 * and `value === 0` is preserved as `'%'` (0 is 0 on either reading).
 *
 * So the boundary below is CEE's boundary, transcribed — not a heuristic:
 *   |v| <  1  ⇒ already fractional ⇒ IDENTITY [0,1]; forward the value as-is.
 *   |v| >= 1  ⇒ percentage points  ⇒ [0,100]; divide by 100 (UNCHANGED
 *               behaviour — this is what the rung has always done).
 *
 * ⚠ WHAT THIS FIXES. The rung previously used [0,100] unconditionally, so
 * `{unit:'%', value:0.04}` — the producer's own canonical example, meaning 4% —
 * became **0.0004** whenever any constraint in the batch opened the
 * normalisation gate, and stayed a correct **0.04** when none did. A hundredfold
 * understatement decided by an UNRELATED constraint's value. Fixing the
 * gate-OPEN arm (rather than dragging the gate-closed arm to match it) is what
 * makes the two agree on the value the producer meant.
 *
 * ⚠ AN EARLIER REVISION OF THIS ROW MOVED THE OTHER WAY — it read `'%'` as
 * always-percentage-points and normalised the sub-1 cell to `v/100`. That was
 * refuted at the producer's bytes: it would have turned `0.04` into `0.0004` on
 * the primary draft path, i.e. it would have INTRODUCED the defect above on the
 * one path that was still correct. The lesson is recorded here because the
 * mistake is re-makeable from PLoT's side alone: the contract line
 * ("Threshold in the user's units; PLoT normalises downstream") does NOT settle
 * which scale `'%'` denotes, and a full mutant kill-rate against that wrong
 * oracle proves only sensitivity, never correctness.
 *
 * ⚠ KNOWN-AMBIGUOUS, deliberately left as CEE has it: a ratio that legitimately
 * exceeds 100% (NRR 110%) is emitted by the draft prompt as `value: 1.10,
 * unit: "%"` on a NODE, while CEE's CONSTRAINT rule reads `>= 1` as percentage
 * points. For a constraint that lands at `1.10` the two readings differ. This
 * function does NOT resolve it — it reproduces CEE's stated constraint rule
 * exactly, so PLoT is never the service that invented a third convention.
 */
function percentRangeForValue(value: number): NormalisationRange {
  return Math.abs(value) < 1
    ? { min: 0, max: 1, source: 'unit_percent' }
    : { min: 0, max: 100, source: 'unit_percent' };
}

/**
 * ROADMAP 2.957 — true when a `'%'` constraint exists whose value the percent
 * rung WOULD rescale (i.e. percentage-point form, `|value| >= 1`).
 *
 * WHY THIS EXISTS, and it is a narrow, derived thing. `constraintsNeedNormalisation`
 * opens the gate on `value < 0 || value > 1`. `value === 1` satisfies neither,
 * so a lone `{unit:'%', value:1}` — ONE PERCENT by CEE's `>= 1` rule — was
 * forwarded raw as `1.0` (a hundred percent) when alone, while resolving to
 * `0.01` the moment any batch-mate opened the gate. Every other percentage-point
 * value already opens the gate by magnitude, so this closes the single
 * remaining cell where the answer still depended on a DIFFERENT constraint.
 *
 * Stated as `|value| >= 1` rather than `value === 1` on purpose: it is the
 * genuine precondition ("the rung would rescale this"), so it stays correct if
 * the gate's own bounds ever move, instead of encoding today's off-by-one.
 */
export function constraintsHavePercentPointValue(
  constraints: GoalConstraint[],
  unitsByConstraintId: Map<string, string> | undefined,
): boolean {
  if (unitsByConstraintId === undefined || unitsByConstraintId.size === 0) return false;
  for (const constraint of constraints) {
    if (isPercentPointValue(unitsByConstraintId.get(constraint.constraint_id), constraint.value)) {
      return true;
    }
  }
  return false;
}

/**
 * ROADMAP 2.957 — THE single predicate for "this constraint is stated in
 * PERCENTAGE POINTS and the '%' rung will therefore rescale it".
 *
 * Three sites need this exact question — the route's invocation condition, the
 * forward-raw rung's exemption, and (as its complement) the scale chosen by
 * `percentRangeForValue`. They MUST agree: if the route forces the normaliser
 * to run for a value the forward-raw rung then forwards untouched, the extra
 * invocation is a no-op and the batch-dependence survives. That is not a
 * hypothetical — it is what a first cut of this fix did at `value === 1`,
 * caught by the batch-invariance sweep. One predicate, three callers.
 */
function isPercentPointValue(unit: string | undefined, value: number): boolean {
  return isPercentUnit(unit) && Number.isFinite(value) && Math.abs(value) >= 1;
}

/**
 * Range sources whose numeric bounds are read off the TARGET NODE's
 * `observed_state`, and which therefore inherit `observed_state.unit` as the
 * declared unit OF THE SCALE. Only for these can a constraint's own declared
 * unit be compared against the scale's — for every other source there is no
 * declared scale unit to compare with, and claiming one would be an invention.
 *
 * EVERY `RangeSource` member, with its verdict and the reason (audit the
 * predicate's DOMAIN, not just the named case):
 *   explicit_cap       IN  — `[0, observed_state.cap]`; cap is stated in
 *                            `observed_state.unit`. THE WITNESSED DEFECT.
 *   inferred_baseline  IN  — bounds from `observed_state.baseline` / `.value`.
 *   inferred_value     IN  — bounds from `observed_state.value`.
 *   explicit           OUT — `state_space.range` carries NO unit field at all
 *                            (`types/engine-v3.ts:124-126`), so there is
 *                            nothing to compare; measured, not assumed.
 *   extracted          OUT — CE `intervention_hints.extracted_range`; its
 *                            provenance is the extraction, not observed_state.
 *   inferred_spread    OUT — min/max of INTERVENTION values across options;
 *                            same provenance argument as `extracted`.
 *   goal_threshold_cap OUT — a producer declaration minted for the goal
 *                            threshold, not read from observed_state.
 *   unit_percent       OUT — the range IS the constraint's own '%' unit
 *                            (`[0,100]`), so it is reconciled by construction.
 *   default            OUT — `[0,1]`, a made-up domain with no unit. Already
 *                            fails closed elsewhere: `'default'` is outside
 *                            `DECISION_GRADE_SOURCES` and already trips
 *                            `threshold_normalisation_defaulted` suppression.
 */
const OBSERVED_STATE_SCALE_SOURCES: ReadonlySet<RangeSource> = new Set<RangeSource>([
  'explicit_cap',
  'inferred_baseline',
  'inferred_value',
]);

/**
 * The declared unit of the scale a resolved range represents, or `undefined`
 * when that range has no declared unit (see `OBSERVED_STATE_SCALE_SOURCES`).
 */
export function resolveScaleUnit(
  range: NormalisationRange,
  targetNode: EngineNodeV3 | undefined,
): string | undefined {
  if (!OBSERVED_STATE_SCALE_SOURCES.has(range.source)) return undefined;
  return canonicaliseUnit(targetNode?.observed_state?.unit);
}

/**
 * Tolerance (on the normalised [0,1] scale) for treating the node's
 * CEE-stamped goal_threshold as "the same target" as the re-normalised raw
 * constraint value. Wide enough to absorb producer rounding (4 dp), narrow
 * enough that a genuinely changed target (e.g. 25% vs a stale 0.2 stamp) is
 * NOT silently overridden by the stale stamp.
 */
const GOAL_THRESHOLD_CORRESPONDENCE_TOLERANCE = 1e-3;

/**
 * Result of constraint normalisation.
 */
export interface ConstraintNormalisationResult {
  /** Normalised constraints */
  constraints: NormalisedGoalConstraint[];
  /** Repair records for auditing */
  repairs: RepairRecord[];
  /** Diagnostics for logging */
  diagnostics: Array<{
    constraint_id: string;
    node_id: string;
    original_value: number;
    normalised_value: number;
    range: NormalisationRange;
    used_heuristic: boolean;
    /**
     * True when the raw threshold fell OUTSIDE the normalisation range and was
     * clamped onto [0,1] (Codex F2a). The clamp DIRECTION is read from
     * normalised_value at egress (0 ⇒ clamped at the range floor, 1 ⇒ at the
     * ceiling). A clamped threshold makes the emitted failure_margin a strict
     * bound, not an exact distance — the margin egress consults this so it never
     * labels an understated margin 'exact'.
     */
    clamped: boolean;
    /**
     * A3 R1: recorded at ladder-decision time (here — where BOTH the resolved
     * range and the node's intervention scale are in hand), so the trust marker
     * can PROJECT it rather than re-derive it 700 lines away. TRUE when the
     * threshold's scale did NOT diverge from the node's producer-declared scale:
     * a measured (non-identity) intervention spread was adopted as the threshold
     * scale (ladder branch 1) AND a producer declared a DIFFERENT scale
     * (goal_threshold_cap / '%') for the same node. NUMERIC-equality test — equal
     * bounds are the SAME scale (no divergence). No producer declaration, an
     * identity (assumed) intervention scale, or no intervention scale ⇒ TRUE
     * (nothing to diverge from).
     */
    range_unified: boolean;
    /**
     * Present ONLY when the constraint's declared unit and the declared unit of
     * the SCALE it was normalised against name different quantity kinds — the
     * witnessed `count`-threshold-over-a-`%`-cap collision. Recorded here, at
     * the one place holding BOTH the constraint's unit and the resolved range,
     * and PROJECTED downstream (scale_provenance → the reliability gate) rather
     * than re-derived. Absence is not a reconciliation: an undeclared unit on
     * either side records nothing (see `classifyUnitCompatibility`).
     *
     * ⚠ The `normalised_value` recorded alongside this IS the mis-scaled number
     * — it is kept so diagnostics/logs stay complete, and it is precisely what
     * the consumers must refuse to deliver or to badge.
     */
    unit_mismatch?: ConstraintUnitMismatch;
    /** True when the node's CEE-stamped goal_threshold was preferred (P0-C1) */
    used_node_goal_threshold?: boolean;
  }>;
  /**
   * ROADMAP 2.878 — constraints REFUSED rather than forwarded, because
   * normalisation would have changed the number a `delta` attestation stands
   * behind. Empty on every path that does not hit that case. See
   * `DELTA_FRAME_VALUE_ALTERED` for the full reasoning.
   */
  refused: RefusedConstraintRecord[];
}

/**
 * ROADMAP 2.878 — the single reason PLoT refuses to forward a constraint it
 * successfully normalised. A union of one, deliberately: a new refusal reason
 * must be added HERE and every consumer's exhaustiveness check moves with it,
 * rather than a bare string that can accrete meanings silently.
 */
export type ConstraintRefusalReason = 'delta_frame_value_altered_by_normalisation';

/** ROADMAP 2.878 — see {@link ConstraintRefusalReason}. */
export const DELTA_FRAME_VALUE_ALTERED: ConstraintRefusalReason =
  'delta_frame_value_altered_by_normalisation';

/**
 * ROADMAP 2.878 — a constraint that PLoT declined to send to ISL, with the
 * quantities that made the refusal necessary. Shaped so it can be widened into
 * `FilteredConstraintRecord` (`{constraint_id, node_id, reason}`) for
 * `_meta.filtered_constraints` without a second hand-copy.
 */
export interface RefusedConstraintRecord {
  constraint_id: string;
  node_id: string;
  reason: ConstraintRefusalReason;
  /** The quantity the user stated, exactly as it arrived. */
  stated_value: number;
  /** The number normalisation would have sent in its place. */
  would_have_sent: number;
  /** The range whose scale produced that substitution. */
  range: NormalisationRange;
}

/**
 * Normalise goal constraint values to [0,1] space.
 *
 * Uses the same deriveRange() function as interventions, resolved through a
 * measurement/producer priority ladder (F4, Codex-confirmed reorder). This
 * header MIRRORS the authoritative inline `Derive range` comment in the loop
 * body below — keep the two in sync:
 *
 * | Priority | Source                            | Rule                                             |
 * |----------|-----------------------------------|--------------------------------------------------|
 * | 1        | `interventionScale` (NON-identity)| A MEASURED sample spread is ground truth; the    |
 * |          |                                   | threshold shares the exact scale its samples     |
 * |          |                                   | occupy. Wins even over a producer cap (DOCTRINE- |
 * |          |                                   | PENDING).                                        |
 * | 2        | forward-raw                       | Gate FALSE + no intervention scale ⇒ value       |
 * |          |                                   | already in [0,1]; forwarded verbatim (HEAD       |
 * |          |                                   | parity, F1). Outranks producers.                 |
 * | 3        | `goal_threshold_cap`              | Producer-declared. Node's CEE-stamped cap.       |
 * |          |                                   | Range [0, cap].                                  |
 * | 4        | `unit_percent`                    | Producer-declared. Constraint unit is '%'.       |
 * |          |                                   | Range [0, 100] (house doctrine).                 |
 * | 5        | `interventionScale` (IDENTITY)    | Phase-4a-skipped ASSUMED [0,1] scale; ranks      |
 * |          |                                   | below producer declarations, above the heuristic.|
 * | 6        | deriveRange(node)                 | Existing chain (explicit_cap → … → default).     |
 *
 * Additionally, when the node carries a CEE-stamped, already-normalised
 * finite `goal_threshold` in [0,1] that corresponds to the same target
 * (|value/cap − goal_threshold| ≤ 1e-3 under a producer-declared cap), the
 * stamp is PREFERRED over re-normalising the raw client value — CEE is the
 * producer of both numbers, so its normalisation is authoritative and free of
 * re-derivation drift. A stamp that does NOT correspond (e.g. stale after the
 * user changed the target) is ignored.
 *
 * Preserves original user-unit value for response denormalisation.
 *
 * @param constraints Goal constraints to normalise
 * @param nodes Graph nodes (for range derivation)
 * @param extras Producer-declared scale signals (units, node goal-threshold metadata)
 * @returns Normalised constraints with original values preserved
 */
export function normaliseGoalConstraints(
  constraints: GoalConstraint[],
  nodes: EngineNodeV3[],
  extras?: ConstraintNormalisationExtras
): ConstraintNormalisationResult {
  const repairs: RepairRecord[] = [];
  const diagnostics: ConstraintNormalisationResult['diagnostics'] = [];
  const normalisedConstraints: NormalisedGoalConstraint[] = [];
  // ROADMAP 2.878 — constraints refused rather than forwarded with an altered value.
  const refused: RefusedConstraintRecord[] = [];

  // Build node lookup map
  const nodeMap = new Map<string, EngineNodeV3>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Loop-invariant (does not vary per constraint). Default TRUE so every existing
  // caller (unit tests, code paths that omit the flag) keeps the pre-fix chain
  // behaviour for scale-less constraints.
  const applyChainWithoutScale = extras?.normaliseWithoutScale ?? true;

  for (const constraint of constraints) {
    const { constraint_id, node_id, operator, value, label, weight, value_frame } = constraint;

    // Find target node
    const targetNode = nodeMap.get(node_id);

    // Producer-declared scale signals (P0-C1)
    const nodeMeta = extras?.goalThresholdMetaByNodeId?.get(node_id);
    const unit = extras?.unitsByConstraintId?.get(constraint_id);
    const nodeCap = nodeMeta?.goal_threshold_cap;

    // The scale this node's INTERVENTIONS were normalised against (Phase 4a).
    const interventionScale = extras?.interventionScaleByNodeId?.get(node_id);
    // An IDENTITY [0,1] intervention scale is the route's marker for "this node
    // was intervened while Phase 4a was SKIPPED" (all interventions already in
    // [0,1]) — it is an ASSUMPTION, not a measured spread. A NON-identity scale
    // is a measured ground-truth spread. The two rank very differently below.
    const interventionScaleIsIdentity =
      interventionScale !== undefined && isIdentityRange(interventionScale);

    // Derive range. Priority ladder (F4, Codex-confirmed reorder):
    //   1  interventionScale, NON-identity — a MEASURED spread is ground truth;
    //      the threshold MUST share the exact scale its samples occupy
    //      (A3 range-unify). Wins even over a producer cap (DOCTRINE-PENDING).
    //   2  forward-raw — gate FALSE + no intervention scale ⇒ value already in
    //      [0,1] ⇒ leave it untouched (HEAD parity, F1). MUST outrank producers.
    //   3  goal_threshold_cap  (producer-declared)   ]  a producer DECLARATION
    //   4  unit_percent        (producer-declared)   ]  outranks an ASSUMED
    //                                                    identity scale (F4).
    //   5  interventionScale, IDENTITY — the Phase-4a-skipped assumption; ranks
    //      BELOW producer declarations, ABOVE the node heuristic, so the
    //      core no-producer-metadata combos stay unchanged.
    //   6  deriveRange(node)   (existing chain: explicit_cap → … → default)
    // If node not found and no declared scale, use default [0,1].
    let range: NormalisationRange;
    // Forwarded-raw ⇒ value is already in [0,1] (the global gate was FALSE) and
    // this node has no intervention scale: leave it untouched, emit no repair.
    let forwardedRawUnchanged = false;
    if (interventionScale && !interventionScaleIsIdentity) {
      // DOCTRINE-PENDING: when a node carries BOTH a MEASURED intervention spread
      // scale and a producer-declared cap (goal_threshold_cap / '%' / explicit_cap
      // / state_space.range) and the two DISAGREE, this fix picks the
      // intervention-side range — it is the scale the ISL samples actually live
      // on, so it is the only choice that keeps threshold and samples
      // comparable. WHICH of the two should be authoritative when they diverge
      // is an unratified doctrine call (owner: A3 lead). Sameness is the
      // invariant here; the pick is provisional. (F4: this branch is now gated on
      // NON-identity — an identity scale is an assumption, demoted to branch 5.)
      range = interventionScale;
    } else if (!applyChainWithoutScale && !isPercentPointValue(unit, value)) {
      // ROADMAP 2.957 — the `!isPercentPointValue` conjunct closes the LAST cell
      // where a '%' threshold's meaning depended on a DIFFERENT constraint.
      // The gate fires on `value < 0 || value > 1`, so `value === 1` opens
      // nothing: `{unit:'%', value:1}` — ONE percentage point by CEE's `>= 1`
      // rule — was forwarded raw here as `1.0` (a HUNDRED percent) when alone,
      // while resolving to `0.01` the moment any batch-mate opened the gate.
      // `value === 1` is the only value this can reach (every other
      // percentage-point magnitude already opens the gate), so the blast radius
      // is exactly that cell.
      //
      // ⚠ NOTE THE NARROWNESS, and do NOT widen it to all '%' units. A sub-1
      // '%' value is ALREADY FRACTIONAL (CEE's LLM extractor emits "4%" as
      // 0.04), so forwarding it raw here is CORRECT and must stay — exempting
      // it would rescale 0.04 to 0.0004. See `percentRangeForValue` for the
      // producer citations; an earlier revision of this row made exactly that
      // mistake.
      //
      // F1 (adversarial review): the global gate did NOT fire and this node has
      // NO intervention scale ⇒ the value is already in [0,1] by definition of
      // the gate; forward it verbatim (identity). This decision MUST precede the
      // producer goal_threshold_cap / '%' branches below: at HEAD the function
      // was NOT called for a constraint on a non-intervened node when the gate
      // was false, so a producer cap or '%' unit on such a node must NOT drag the
      // value through a normalisation HEAD never applied (e.g. '%' value 0.5 →
      // 0.005, a new repair, margin denorm ×100). Restores exact HEAD parity for
      // non-intervened nodes in the gate-false + some-other-node-has-a-scale
      // combo. When the gate IS true (or unset — every direct-unit-test caller),
      // this branch is skipped and the producer/chain branches apply as before.
      range = { min: 0, max: 1, source: 'default' };
      forwardedRawUnchanged = true;
    } else if (typeof nodeCap === 'number' && Number.isFinite(nodeCap) && nodeCap > 0) {
      range = { min: 0, max: nodeCap, source: 'goal_threshold_cap' };
    } else if (isPercentUnit(unit)) {
      range = percentRangeForValue(value);
    } else if (interventionScale) {
      // F4 branch 5: an IDENTITY [0,1] intervention scale (Phase 4a skipped for
      // this intervened node). Reached only when no producer '%'/cap declared it
      // (those are handled above). Keeps the threshold on the SAME raw sample
      // scale the interventions occupy, rather than independently re-deriving a
      // node heuristic. (interventionScaleIsIdentity is necessarily true here.)
      range = interventionScale;
    } else {
      range = targetNode
        ? deriveRange(targetNode)
        : { min: 0, max: 1, source: 'default' };
    }

    // A3 R1 (false-divergence fix): decide range_unified HERE, at ladder-decision
    // time, and record it in the diagnostic — the trust marker then PROJECTS it
    // (no re-derivation from inputs 700 lines away). Divergence — range_unified
    // FALSE — arises ONLY when a MEASURED (non-identity) intervention spread was
    // adopted as the threshold scale (branch 1) while a producer declared a
    // scale (goal_threshold_cap / '%') for the same node AND the two scales
    // DIFFER NUMERICALLY. Equal bounds are the SAME scale ⇒ the threshold sits on
    // the samples' scale ⇒ NO divergence (the bug this fixes assumed divergence on
    // mere co-presence). No producer declaration, an identity (assumed) scale, or
    // no intervention scale ⇒ nothing to diverge from ⇒ TRUE.
    const producerDeclaredRange: NormalisationRange | undefined =
      typeof nodeCap === 'number' && Number.isFinite(nodeCap) && nodeCap > 0
        ? { min: 0, max: nodeCap, source: 'goal_threshold_cap' }
        : isPercentUnit(unit)
          // DERIVED from the same helper the rung uses (2.957) — two copies of
          // the percent-scale decision is exactly the hand-maintained mirror
          // that lets the divergence verdict drift from the range it describes.
          ? percentRangeForValue(value)
          : undefined;
    const rangeUnified =
      interventionScale === undefined ||
      interventionScaleIsIdentity ||
      producerDeclaredRange === undefined ||
      rangesEqual(interventionScale, producerDeclaredRange);

    // Normalise value — explicit absence handling (ROADMAP 1.278).
    //
    // REACHABILITY of a non-finite `value` here: NONE, from any of the three
    // producers of a GoalConstraint, each already finiteness-guarded:
    //   1. client `body.goal_constraints`  → routes/v2/run.ts Phase 1b++
    //      ingress-shape guard rejects a non-finite `value` with a 422
    //      INVALID_CONSTRAINT_SHAPE naming the index and field.
    //   2. graph-compiled constraint nodes → normalisation/constraint-compiler.ts
    //      skips a node whose observed_state.value is not a finite number.
    //   3. auto-synthesis from goal_threshold → routes/v2/run.ts guards
    //      `Number.isFinite(autoThreshold)`, and goal_threshold itself is
    //      parsed with an explicit null→undefined + isFinite branch.
    // `NormalisedGoalConstraint.normalised_value` is a required number, so — as
    // at the intervention call site above — refusing is the only disposal that
    // neither fabricates nor silently drops a constraint from the analysis.
    const constraintNormalisation = normaliseValue(value, range);
    if (constraintNormalisation === undefined) {
      throw new Error(
        `normaliseGoalConstraints: non-finite value for constraint '${constraint_id}' on node '${node_id}' ` +
        `(received ${JSON.stringify(value) ?? 'undefined'}). ` +
        `Constraint values must be validated at the request boundary before normalisation.`,
      );
    }
    let { normalised, clamped } = constraintNormalisation;

    // Prefer the node's CEE-stamped, already-normalised goal_threshold when it
    // corresponds to the same target under a producer-declared cap.
    let usedNodeGoalThreshold = false;
    const nodeGoalThreshold = nodeMeta?.goal_threshold;
    if (
      // ⭐ NOT WHEN THE VALUE WAS CLAMPED. Written against the SPEC — *a clamped
      // threshold discloses its clamp and is never decision-grade* — rather
      // than against the boundary case this came in on.
      //
      // Preserving `clamped` (the first half of this fix) is necessary and NOT
      // sufficient, because production derives the clamp DIRECTION from
      // `normalised_value` (`deriveClampDirection`). Letting the stamp
      // overwrite that value leaves `clamped: true` carrying a number that is
      // no longer at an endpoint, the direction reads INDETERMINATE,
      // `threshold_clamped` is omitted and `decision_grade` goes true — the
      // exact pre-fix outcome, reached by a different road. Measured: a stated
      // 50000 against a cap of 20000 with a `0.9995` stamp graded TRUE, while
      // the same case with a `1.0` stamp graded false. Sign-symmetric: a
      // `0.0005` stamp does it at the floor.
      //
      // ⚠ AND THE BAND IS REACHABLE BY ORDINARY PHRASING. CEE applies no
      // rounding or quantisation on the goal-threshold path, so "reach 99.95%
      // retention" against a cap of 100 mints exactly `0.9995`; even "99.9%"
      // lands strictly inside the interval as `0.9990000000000001` through
      // float. The correspondence tolerance is 1e-3, so those stamps fall
      // inside it.
      //
      // ADOPTING THE STAMP HERE COULD NEVER HAVE HELPED ANYWAY: the branch only
      // fires when the stamp is within 1e-3 of the clamped value, so the number
      // it would substitute is one the service already knows it had to pin. The
      // preference exists to remove re-derivation drift on values that
      // normalised cleanly, and that is exactly where it still applies.
      !clamped &&
      (range.source === 'goal_threshold_cap' || range.source === 'unit_percent') &&
      typeof nodeGoalThreshold === 'number' &&
      Number.isFinite(nodeGoalThreshold) &&
      nodeGoalThreshold >= 0 && nodeGoalThreshold <= 1 &&
      Math.abs(normalised - nodeGoalThreshold) <= GOAL_THRESHOLD_CORRESPONDENCE_TOLERANCE
    ) {
      normalised = nodeGoalThreshold;
      usedNodeGoalThreshold = true;
      // ⚠ `clamped` IS DELIBERATELY NOT CLEARED HERE, and the line that cleared
      // it was a false-certification seam. `clamped` is the ONLY input that
      // keeps a pinned threshold out of `decision_grade`
      // (`buildConstraintScaleProvenance` requires `thresholdClamp ===
      // undefined`), so clearing it here CERTIFIED the very case it should
      // have disqualified.
      //
      // WHY THE CORRESPONDENCE TEST CANNOT SEE THIS. It compares the stamp
      // against the POST-CLAMP `normalised`. At a boundary stamp (0 or 1) a
      // producer that ALSO clamped emits exactly that boundary, so the two
      // numbers agree BECAUSE BOTH HIT THE SAME WALL — not because they
      // describe the same target. The test's discrimination is destroyed at
      // precisely the values where the clamp fired. Measured: a stated
      // `50000` against a `goal_threshold_cap` of `20000` clamps to `1.0`;
      // with a `goal_threshold: 1.0` stamp it used to report
      // `decision_grade: true` and omit `threshold_clamped` altogether — a
      // compliance claim over a number the user never stated. Sign-symmetric:
      // `-15000` against a `[0,100000]` cap pins to `0` and a `0` stamp
      // certified it the same way.
      //
      // THE ADOPTED VALUE IS UNCHANGED. Inside this branch the stamp is within
      // 1e-3 of the clamped value, so preferring it still removes
      // re-derivation drift exactly as intended — this only stops the
      // preference from also laundering the clamp. Nothing that reaches ISL
      // moves; only the honesty flag does.
      //
      // A NON-CLAMPED correspondence is untouched: `clamped` was already
      // `false`, so an in-range stamp adoption keeps its decision grade (a
      // value landing EXACTLY on the ceiling has `raw === 1`, which is not a
      // clamp, and stays decision-grade). Pinned both ways —
      // tests/gates/constraint-clamp-erasure.test.ts.
    }

    // ROADMAP 2.878 — FRAME FIDELITY. A constraint attested `delta` reaches ISL
    // as the quantity the user stated, or it does not reach ISL at all.
    //
    // WHY THIS IS NOT "the clamp is wrong". `normaliseFiniteValue` computes
    // `(v − min) / (max − min)` and clamps to [0,1]. For a LEVEL — an absolute
    // position on a factor's own bounded scale, which is what every other
    // producer mints — that is correct and the clamp is a DOMAIN GUARD: ISL's
    // sample space is [0,1] by construction, so a level outside the derived
    // range must be pinned to the nearest endpoint, and `clamped: true` is the
    // honest signal that the derived range was too narrow to contain the stated
    // level. Downstream depends on exactly that (see
    // `constraintThresholdClampByConstraintId` in routes/v2/run.ts, which reads
    // the clamp DIRECTION so the margin egress never labels an understated
    // failure margin 'exact'). The clamp is right, and it is left alone.
    //
    // It is category-wrong for a DELTA, in two independent ways, both measured:
    //   1. the translation term. `− min` is meaningless on a DIFFERENCE. A
    //      delta of −0.15 against a sign-preserving range [−1,1] normalises to
    //      **+0.425** — not clamped, not flagged, and not the user's quantity.
    //   2. the clamp itself. Against every range whose floor is 0 — which is
    //      `default`, `unit_percent`, `goal_threshold_cap`, `explicit_cap`, and
    //      `inferred_value` on any positive-domain node, i.e. the overwhelming
    //      majority — a negative delta normalises to **0** for EVERY width.
    //      `−0.15` → `{normalised: 0, clamped: true}`.
    //
    // ⚠ WHAT IS *NOT* CLAIMED, and an earlier draft of this comment got wrong.
    // For a min-0 range the map reduces to `v / width`, which IS the
    // arithmetically correct NORMALISED-SPACE delta — so `+0.05` on `[0,200]`
    // → `0.00025` is only a corruption under the RAW-UNIT reading, and this
    // very file states below that which reading ISL takes is NOT established.
    // The substitution is therefore **unverifiable in either direction**, not a
    // measured 200× error. That is precisely why refusing is right: under
    // genuine uncertainty a gap beats a number nobody can check. Stating it as
    // a settled corruption would be the same over-read this guard exists to
    // prevent (an honest unknown hardening into a claim the next reader
    // inherits without its scope).
    // Case 2's CLAMP, by contrast, is a corruption under BOTH readings: no
    // reading of a delta frame makes `<= 0` mean `<= −0.15`.
    //
    // Case 2 is the P0 this guard exists for. `extractReductionConstraints`
    // mints `{operator: '<=', value: −N}` for "reduce X by N" and attests it
    // `delta`; the clamp turns `<= −0.15` into `<= 0`, so ISL is asked
    // *"P(cost changes by at most 0)"* — **the probability cost falls AT ALL** —
    // and answers it with a confident `prob_satisfied` and no warning, because a
    // frame-faithful `0` is a perfectly well-formed delta. Nothing downstream
    // can recover the question: `original_value` is carried on the PLoT-internal
    // struct and is NOT a field the ISL translator sends.
    //
    // THE PREDICATE IS A UNION OF TWO GUARDS WITH DISJOINT BLIND SPOTS, and
    // that is the whole point — ⚠ an earlier version of this comment claimed
    // the outcome test "cannot be escaped" by the alternatives. THAT WAS FALSE,
    // and it was refuted by execution in review.
    //
    //   `normalised !== value`  — the invariant itself: the number that would
    //      reach ISL is not the number the user stated. Catches case 1 (the
    //      translation term), which `clamped` cannot see at all, and catches a
    //      rescaled positive delta, which a SIGN test cannot see.
    //   `clamped`               — catches what the outcome test provably
    //      misses: THE AFFINE MAP HAS FIXED POINTS, so identity of the OUTPUT
    //      does not imply identity of the TRANSFORM. Measured: range [0,0.5],
    //      delta `1` → raw `2` → clamped DOWN to `1` → `normalised === value`
    //      → the outcome test does not fire, and a HALVING ships with the
    //      'delta' attestation intact. General form: the fixed point
    //      `v = min / (1 − width)` for `width ≠ 1`, plus `v ∈ {0,1}` whenever
    //      the clamp happens to land on the stated value itself.
    //
    // Neither dominates the other, so neither is a "winner" — the OR is
    // load-bearing in both directions and removing either arm reopens a class.
    // A range-SOURCE list was also considered and rejected: it would be a
    // hand-maintained mirror a new ladder rung silently escapes.
    //
    // No false positives from floating point: the only exact-identity path is
    // `min = 0 ∧ width = 1`, where `(v − 0) / 1 === v` exactly in IEEE-754 (and
    // `-0 === 0` under `!==`). So the forward-raw branch and a [0,1] range both
    // leave a faithful delta untouched and unrefused.
    //
    // WHY REFUSE RATHER THAN RESCALE. Rescaling a delta correctly means
    // dividing by the range WIDTH with no offset — but whether ISL's `delta`
    // frame expects a raw-unit difference or a normalised-space difference is
    // NOT established at the bytes. The only witness we hold (arm B of
    // tests/fixtures/isl-constraint-value-frame-20260807) sent `0.05` already on
    // the normalised scale. Minting an arithmetic on an unverified semantics is
    // precisely the fabrication class this chain exists to remove, so PLoT
    // refuses and says so. When ISL's delta scale contract is established, this
    // guard is where the conversion goes — and it will still be the place that
    // refuses anything it cannot convert faithfully.
    //
    // ⚠ SCOPE OF THE REFUSAL — this is NOT a narrow edge case, and it must not
    // be read as one. `normalised === value` requires `min = 0 ∧ width = 1`,
    // and every producer-declared rung has width ≠ 1 by construction
    // (`unit_percent` [0,100], `goal_threshold_cap` [0,cap], `explicit_cap`),
    // while `inferred_value` yields [0, 2·observed] — identity only when the
    // observed value is exactly 0.5. **So in practice this refuses essentially
    // the WHOLE delta class on any in-graph node: delta-framed constraints are
    // non-functional until ISL's delta scale contract is established at the
    // bytes.** That is a deliberate fail-closed posture, not an oversight, and
    // it is the honest state of the capability — recorded here so a later
    // reader does not inherit "refuses what it cannot convert" as an edge case.
    //
    // WHY DROP RATHER THAN THROW. A throw would take out the whole analysis —
    // every option result — over one constraint. The refusal is per-constraint:
    // the run proceeds, every other constraint delivers, and this one is
    // reported by name in `_meta.filtered_constraints` with a `removed` repair
    // record. Dropping the `value_frame` instead was considered and rejected:
    // ISL fail-closes an unstamped constraint by omitting the ENTIRE
    // `constraint_analysis` block, so one bad constraint would silently delete
    // every other constraint's verdict — and it would still send the corrupted
    // number, merely unattested.
    //
    // ⚠⚠ AND THE FIRST VERSION OF THIS FIX REPRODUCED THAT EXACT HARM — the one
    // the paragraph above says it rejected the alternative to avoid. Removing a
    // constraint HERE is only half the job: PLoT's own one-to-one honesty guard
    // (`buildConstraintFields`, routes/v2/run.ts) compares ISL's result count
    // against the ACTIVE constraint list, so a constraint dropped from the ISL
    // payload but left in the active list makes the counts disagree and the
    // WHOLE run reports `constraints_status: 'unavailable'` with zero results.
    // Proven by execution in review: 2 levels + 1 refused delta → 0 results;
    // the same payload with 'level' instead of 'delta' → 3 results. **The
    // caller MUST also remove the refused ids from the active set** — see the
    // `refusedConstraintRecords` handling in routes/v2/run.ts, which mirrors
    // what the temporal filter does by REPLACING the list before the active set
    // is derived. Pinned by tests/constraint-delta-frame-refusal.route.test.ts.
    // ROADMAP 2.1023 — THE AUTO-SYNTHESISED CONSTRAINT UNSTAMPS RATHER THAN
    // REFUSES, because refusing it WITHDRAWS THE USER'S TARGET.
    //
    // Measured, not reasoned: stamping `value_frame` on the synthesised
    // constraint (2.1023) put it inside this refusal for every run where
    // normalisation re-scales the value (e.g. a raw £20k target against a 50k
    // cap → 0.4). The refusal itself behaves correctly — but the 2.239 carry
    // binds `goal_threshold` to the synthesised constraint, so removing the
    // constraint ALSO removed the target, and `goal_threshold` stopped reaching
    // ISL entirely. That silently deletes the DIRECT goal probability, which
    // 2.266's T3/T3b exist to guarantee survives every constraint refusal
    // ("refusing the constraint never withdraws the target").
    //
    // WHY UNSTAMPING IS SAFE HERE AND NOT IN GENERAL. The paragraph above
    // rejects dropping `value_frame` because ISL fail-closes an unstamped
    // constraint by omitting the ENTIRE `constraint_analysis` block, so one
    // unstamped constraint would delete every SIBLING's verdict. The
    // synthesised constraint has no siblings BY CONSTRUCTION: synthesis runs
    // only when the compiled set is empty (`routes/v2/run.ts` — the
    // `constraintCompilation.constraints.length === 0` branch), so it is always
    // the sole constraint. The objection does not reach this case.
    //
    // WHAT THE USER GETS. Exactly today's behaviour for this class: the
    // constraint travels unstamped, ISL declines to evaluate it, and the
    // joint-goal figure is absent — but the TARGET still reaches ISL, so the
    // direct goal probability survives. Strictly no worse than before 2.1023,
    // and better wherever normalisation leaves the value intact (there the
    // stamp stands and the joint-goal science is delivered).
    //
    // ⚠ THIS IS A PINNED KNOWN GAP, NOT A CLOSURE. The joint-goal figure is
    // still unavailable whenever a synthesised target needs re-scaling.
    // Closing it needs the delta-scale contract established at ISL's bytes
    // (the same blocker the paragraph above names) — out of PLoT's hands.
    // `tests/auto-constraint-value-frame.route.test.ts` pins EXACTLY this
    // boundary, so the suite REDs if the gap either grows or silently closes.
    const isAutoSynthesised =
      (constraint as { _internal?: { source?: string } })._internal?.source ===
      'auto_from_goal_threshold';

    if (
      value_frame === 'delta' &&
      (normalised !== value || clamped) &&
      isAutoSynthesised
    ) {
      repairs.push({
        field: `constraint.value_frame.${constraint_id}`,
        action: 'removed',
        from_value: 'delta',
        to_value: 'unstamped',
        reason:
          `the auto-synthesised goal constraint was re-scaled by normalisation ` +
          `(${value} → ${normalised}), so PLoT can no longer attest the frame the ` +
          `number was stated in. The frame is dropped rather than the constraint ` +
          `refused, because refusing it would also withdraw the user's goal target. ` +
          `ISL will not evaluate an unstamped constraint, so the joint-goal figure ` +
          `is absent — the direct goal probability is unaffected.`,
      });
      // Same shape as the normal path below, minus `value_frame` — so the wire
      // is byte-identical to the pre-2.1023 unstamped constraint.
      normalisedConstraints.push({
        constraint_id,
        node_id,
        operator,
        value: normalised,
        original_value: value,
        label,
        weight,
      });
      continue;
    }

    if (value_frame === 'delta' && (normalised !== value || clamped)) {
      refused.push({
        constraint_id,
        node_id,
        reason: DELTA_FRAME_VALUE_ALTERED,
        stated_value: value,
        would_have_sent: normalised,
        range,
      });
      repairs.push({
        field: `constraint.value.${constraint_id}`,
        action: 'removed',
        from_value: value,
        to_value: 'refused',
        reason:
          `refused: a 'delta'-framed constraint value cannot be normalised without ` +
          `changing the quantity it attests (range=[${range.min},${range.max}] ` +
          `source=${range.source} would have sent ${normalised} in place of ${value}). ` +
          `Forwarding it would ask ISL a different question than the user asked.`,
      });
      continue;
    }

    // UNIT COMPATIBILITY (the goal-fit unit collision). Decided HERE, at
    // ladder-decision time, for the same reason range_unified is: this is the
    // only place that holds BOTH the constraint's own declared unit and the
    // range the ladder actually resolved. Consumers PROJECT it.
    //
    // Note the ORDER dependency, which is why this sits after the ladder and not
    // before it: the '%'-unit rung (4) outranks deriveRange (6), so a constraint
    // whose unit IS percent never reaches an observed_state-derived scale in the
    // first place — its range is its own unit's [0,100]. What arrives here is a
    // constraint whose unit lost to, or never competed with, a scale read off
    // the target node.
    const scaleUnit = resolveScaleUnit(range, targetNode);
    const unitCompatibility = classifyUnitCompatibility(unit, scaleUnit);
    const unitMismatch: ConstraintUnitMismatch | undefined =
      unitCompatibility === 'mismatched'
        ? {
            // Both are non-undefined by construction: 'mismatched' is only
            // returned when BOTH sides canonicalised to a declared token.
            constraint_unit: canonicaliseUnit(unit) as string,
            scale_unit: scaleUnit as string,
          }
        : undefined;

    // Track if we used a heuristic (non-producer-declared range)
    const NON_HEURISTIC_SOURCES: ReadonlySet<RangeSource> = new Set<RangeSource>([
      'explicit', 'explicit_cap', 'goal_threshold_cap', 'unit_percent',
    ]);
    const usedHeuristic = !NON_HEURISTIC_SOURCES.has(range.source);

    // Create normalised constraint
    const normalisedConstraint: NormalisedGoalConstraint = {
      constraint_id,
      node_id,
      operator,
      value: normalised,
      original_value: value,
      label,
      weight,
      // ROADMAP 2.855 — the frame survives normalisation UNCHANGED. Normalising
      // a value against its node's range is a change of SCALE, not of FRAME: a
      // level stays a level and a delta stays a delta, so re-deriving or
      // dropping the attestation here would be wrong in both directions.
      ...(value_frame !== undefined && { value_frame }),
    };
    normalisedConstraints.push(normalisedConstraint);

    // A forwarded-raw constraint (gate FALSE, no intervention scale) is an
    // identity no-op — skip BOTH the repair record AND the diagnostic so the
    // response stays byte-identical to the pre-fix "gate false ⇒ no constraint
    // normalisation" path. (A synthetic 'default'-range diagnostic emitted here
    // would trip constraint-reliability.ts's threshold_normalisation_defaulted
    // and SUPPRESS a constraint that HEAD delivered; and no diagnostic ⇒ no
    // constraintNormalisationRanges entry ⇒ the reliability gate and margin
    // denorm behave exactly as before.)
    if (!forwardedRawUnchanged) {
      // Add repair record.
      repairs.push({
        field: `constraint.value.${constraint_id}`,
        action: 'normalised',
        from_value: value,
        to_value: normalised,
        reason: `normalised range=[${range.min},${range.max}] source=${range.source}${clamped ? ' (clamped)' : ''}${usedNodeGoalThreshold ? ' (node goal_threshold preferred)' : ''}`,
      });
      // Add diagnostic.
      diagnostics.push({
        constraint_id,
        node_id,
        original_value: value,
        normalised_value: normalised,
        range,
        used_heuristic: usedHeuristic,
        // F2a: carry whether the threshold clamped. When the CEE goal_threshold
        // stamp was preferred, `clamped` was reset to false above (the stamp is
        // an exact in-[0,1] value, no clamp), so this is correct in that branch too.
        clamped,
        // A3 R1: the scale-unity decision, recorded for the trust marker to project.
        range_unified: rangeUnified,
        // The unit collision, recorded for the trust marker AND the reliability
        // gate to project. Present only on a genuine mismatch.
        ...(unitMismatch !== undefined && { unit_mismatch: unitMismatch }),
        ...(usedNodeGoalThreshold && { used_node_goal_threshold: true }),
      });
    }

    // Heuristic use is captured in diagnostics[].used_heuristic and repair records.
  }

  return {
    constraints: normalisedConstraints,
    repairs,
    diagnostics,
    refused,
  };
}

/**
 * Check if constraint normalisation is needed.
 *
 * Returns true if any constraint value is outside [0, 1].
 *
 * @param constraints Constraints to check
 * @returns True if normalisation is needed
 */
export function constraintsNeedNormalisation(constraints: GoalConstraint[]): boolean {
  for (const constraint of constraints) {
    if (constraint.value < 0 || constraint.value > 1) {
      return true;
    }
  }
  return false;
}
