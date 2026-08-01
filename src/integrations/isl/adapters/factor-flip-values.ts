/**
 * ISL `factor_flip_values` → PLoT `FlipThresholdInputData[]` adapter.
 *
 * ROADMAP 2.228-F3. This is the seam that replaces PLoT's own bisection flip
 * probe on the /v2/run path.
 *
 * THE GAP THIS CLOSES. ISL PR #117 computes closed-form factor flips, but the
 * capability is REQUEST-GATED (`include_factor_flips`, default False) and PLoT
 * neither sent the flag nor mapped the response — so `factor_flip_values` was
 * never on any live envelope. Meanwhile PLoT's own probe selected candidates by
 * |elasticity| after lever suppression, a class the 2.228 diagnosis proved
 * argmax-invariant by construction: 43 live rows, zero `found`. Every published
 * `flip_thresholds[]` row carried `flip_value: null` under a
 * `no_effect_within_bounds` label the probe had never established.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not denormalise. Rows leave here in
 * ISL's normalised [0,1] domain and go through the SAME
 * `denormaliseFlipThresholds` path that #298 built, so `value_scale: 'display'`
 * is still stamped only where an `explicit_cap` range genuinely lifted the
 * pair. Nothing here weakens that refusal.
 *
 * ABSENT-NOT-ZERO (the doctrine in `types/engine-v3.ts` on `evpi_status`,
 * applied here to flips). A row ISL attests cannot flip keeps `flip_value:
 * null` and its attested `flip_reason`. It is never coerced to 0, never given a
 * `direction`, and never dropped — an attested no-flip is a RESULT, and
 * deleting it would be indistinguishable from never having asked.
 */

import type { EngineGraphV3, EngineNodeV3 } from '../../../types/engine-v3.js';
import type { FlipThresholdInputData } from '../../../cee/validation/m1-review-types.js';
import type { ISLFactorFlipValueV2 } from '../types/isl-types.js';

/**
 * Per-factor label source. Only the two fields this adapter reads are
 * required, so callers can pass PLoT's transformed factor-sensitivity rows
 * without a cast.
 */
export interface FactorLabelSource {
  factor_id: string;
  factor_label?: string;
}

export interface MapFactorFlipValuesContext {
  /**
   * The graph the ISL request was built from. Supplies each row's `unit` (from
   * `observed_state.unit`) and the label of last resort. Optional: a caller
   * without a graph gets rows without units rather than no rows.
   */
  graph?: EngineGraphV3;
  /**
   * PLoT's transformed factor-sensitivity rows, used for `factor_label`. ISL
   * emits `factor_id` only — the label is PLoT-side presentation data and ISL
   * correctly does not invent one.
   */
  factorSensitivity?: readonly FactorLabelSource[];
}

/** Diagnostics for the structured log line — counts only, never values. */
export interface FactorFlipMappingDiagnostics {
  /** Rows received from ISL, before any rejection. */
  received: number;
  /** Rows emitted. */
  mapped: number;
  /** Rows rejected because a REQUIRED field was missing or the wrong type. */
  rejected_malformed: number;
  /** Rows whose `flip_reason` is 'found' AND which carry a finite `flip_value`. */
  found: number;
  /**
   * Rows whose `flip_reason` is 'found' but whose `flip_value` was absent or
   * non-finite — a producer contradiction. Emitted as
   * `found_without_value` rather than trusted; see `normaliseReason`.
   */
  found_without_value: number;
  /** Rows whose `baseline_winner_id` disagrees with the MC-recommended winner (ISL design R3). */
  baseline_winner_disagreement: number;
  /**
   * Review S3 — rows carrying a real `flip_value` whose `direction` was absent
   * or not one of ISL's two tokens, where PLoT DERIVED the direction from
   * `sign(flip_value - current_value)`. Arithmetic on two numbers ISL supplied,
   * not an inference — but counted, because a producer that omits the field is
   * telling you something.
   */
  direction_derived: number;
  /**
   * Review S3 — rows carrying a real `flip_value` for which NO direction is
   * derivable (`flip_value === current_value`, or a non-finite
   * `current_value`). These are downgraded: the value is nulled and the row is
   * marked `value_without_direction`, so the biconditional below holds.
   */
  value_without_direction: number;
  /**
   * Review S3 — rows where ISL's own `direction` token DISAGREES with
   * `sign(flip_value - current_value)`. ISL's claim is emitted UNCHANGED (it is
   * the producer's to make); the disagreement is disclosed, never reconciled —
   * same posture as `baseline_winner_disagreement`.
   */
  direction_disagrees_with_delta: number;
}

export interface MapFactorFlipValuesResult {
  rows: FlipThresholdInputData[];
  diagnostics: FactorFlipMappingDiagnostics;
}

/**
 * Reason emitted when ISL claims `'found'` but ships no usable `flip_value`.
 *
 * This cannot be silently downgraded to `no_effect_within_bounds`: that reason
 * is an ATTESTATION that the slopes differ and no crossing lies in range, and
 * PLoT has not established it. It is a producer contradiction, and it gets its
 * own token so the status classifier files it as UNRESOLVED, never as a
 * confident no-effect.
 */
export const FOUND_WITHOUT_VALUE_REASON = 'found_without_value';

/** Reason of last resort for a row whose `flip_reason` is missing or empty. */
export const UNATTESTED_REASON = 'unattested';

/**
 * Reason emitted when a row carries a real `flip_value` but no direction can be
 * stated for it and none can be derived (review S3).
 *
 * The mirror image of {@link FOUND_WITHOUT_VALUE_REASON}, and downgraded for the
 * same reason: publishing `flip_value: X` with `direction: 'none'` would break
 * the `direction === 'none'` ⟺ `flip_value === null` biconditional that three
 * doc sites and CEE's consumers rely on, and a consumer cannot act on a
 * tipping point it cannot be told which way to cross.
 */
export const VALUE_WITHOUT_DIRECTION_REASON = 'value_without_direction';

/**
 * The `direction` token carried by a row with no flip.
 *
 * ⚠ NOT a direction. It is the explicit statement that none is claimed, forced
 * into existence by `@talchain/schemas` typing `flip_thresholds[].direction` as
 * a REQUIRED string. Omitting the key would be more honest and is the rowed
 * end-state; until the schema field is optional, emitting a guessed
 * `'increase'`/`'decrease'` here would be the fabrication ISL's contract
 * forbids, and omitting it would trip the enrichment egress guard on every
 * honest no-flip row. `'none'` is the only option that lies to nobody.
 */
export const NO_DIRECTION = 'none';

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Map ISL's `factor_flip_values` block into PLoT's flip-threshold input rows.
 *
 * @param raw The envelope's `factor_flip_values`, as received (unvalidated).
 * @param ctx Label/unit sources and the MC-recommended winner for the R3 check.
 * @returns `undefined` when ISL emitted NO block at all — the caller must treat
 *   that as "not computed" (ISL discloses `FACTOR_FLIPS_UNAVAILABLE` on
 *   `inference_warnings`, which run.ts already merges), NOT as "nothing can
 *   flip". An EMPTY array is a different statement — ISL ran the phase and
 *   found no eligible root factors — and returns `{ rows: [] }`.
 */
export function mapIslFactorFlipValues(
  raw: unknown,
  ctx: MapFactorFlipValuesContext & { recommendedWinnerId?: string } = {},
): MapFactorFlipValuesResult | undefined {
  // ABSENCE IS NOT EMPTINESS. `undefined`/`null` means the block never arrived;
  // a non-array is a contract break we refuse rather than coerce.
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;

  const nodesById = indexNodes(ctx.graph);
  const labelsById = indexLabels(ctx.factorSensitivity);

  const diagnostics: FactorFlipMappingDiagnostics = {
    received: raw.length,
    mapped: 0,
    rejected_malformed: 0,
    found: 0,
    found_without_value: 0,
    baseline_winner_disagreement: 0,
    direction_derived: 0,
    value_without_direction: 0,
    direction_disagrees_with_delta: 0,
  };

  const rows: FlipThresholdInputData[] = [];

  for (const entry of raw as ISLFactorFlipValueV2[]) {
    if (entry === null || typeof entry !== 'object') {
      diagnostics.rejected_malformed++;
      continue;
    }

    // REQUIRED by ISL's model. A row missing either of these is not a flip
    // statement about anything identifiable, so it is refused rather than
    // repaired — repairing it would invent the identity the row is about.
    if (!isNonEmptyString(entry.factor_id) || !isFiniteNum(entry.current_value)) {
      diagnostics.rejected_malformed++;
      continue;
    }

    const node = nodesById?.get(entry.factor_id);

    // `exclude_none` means an absent key and an explicit null both mean
    // "no flip". Only a FINITE number is a flip value; NaN/Infinity are not
    // clamped, they are treated as absent (and disclosed via the reason).
    const flipValue = isFiniteNum(entry.flip_value) ? entry.flip_value : null;

    const reason = normaliseReason(entry.flip_reason, flipValue, diagnostics);

    // ⚠ DIRECTION IS NEVER GUESSED. ISL emits `direction` only alongside a real
    // `flip_value`; its contract calls a direction for a non-existent flip "a
    // fabricated claim". The honest rendering would be an ABSENT key, but the
    // shared contract requires a string here (see the invariant note on
    // `FlipThresholdInputData.direction`), so a no-flip row carries the
    // explicit non-claiming token instead. This is where the retired probe was
    // actively misleading: `computeFlipThresholdData` stamped a hypothesised
    // 'increase'/'decrease' from |elasticity| on rows it never resolved.
    //
    // ⚠ REVIEW S3 — BOTH HALVES OF THE BICONDITIONAL ARE ENFORCED HERE.
    // `direction === 'none'` ⟺ `flip_value === null` was previously enforced
    // only forwards: a row with a real value but an absent or non-token
    // direction fell into the `: NO_DIRECTION` arm SILENTLY and UNCOUNTED,
    // publishing a value that claimed 'none' — the documented invariant broken
    // in the data while three doc sites asserted it held.
    const { direction, flipValue: resolvedFlipValue, reason: resolvedReason } =
      resolveDirection(entry, flipValue, reason, diagnostics);

    // ISL design R3: the closed-form search runs in the EXPECTED-VALUE world,
    // which is not guaranteed to agree with the sampled MC recommendation.
    // Counted and logged, never silently reconciled — a consumer that needs to
    // fail closed reads the count, and neither winner id is rewritten here.
    if (
      isNonEmptyString(ctx.recommendedWinnerId) &&
      isNonEmptyString(entry.baseline_winner_id) &&
      entry.baseline_winner_id !== ctx.recommendedWinnerId
    ) {
      diagnostics.baseline_winner_disagreement++;
    }

    const row: FlipThresholdInputData = {
      factor_id: entry.factor_id,
      factor_label: labelsById?.get(entry.factor_id) ?? node?.label ?? entry.factor_id,
      current_value: entry.current_value,
      flip_value: resolvedFlipValue,
      flip_reason: resolvedReason,
      // `alternative_winner_id` is meaningful ONLY beside a real flip value.
      // ISL already nulls it otherwise; this re-asserts the invariant so a
      // future producer bug cannot name a winner for a flip that never happens.
      alternative_winner_id:
        resolvedFlipValue !== null && isNonEmptyString(entry.alternative_winner_id)
          ? entry.alternative_winner_id
          : null,
      // Closed form: no bisection, no probes. Both are 0 by CONSTRUCTION here,
      // not "unknown" — the values are algebraic, so any non-zero count would
      // be a fiction about how they were obtained.
      iterations_used: 0,
      probes_used: 0,
      direction,
      // ⚠ REVIEW S2 — THE STRUCTURAL SIGNAL THAT ENDS THE STRING MIRRORING.
      // CEE currently recognises an attested no-flip by exact-matching
      // `flip_reason === 'no_effect_within_bounds'`
      // (olumi-assistants-service `src/orchestrator-v5/context/analysis-signals.ts:439`
      // at staging `6766b540`), so every reason token ISL adds to its OPEN
      // vocabulary silently drops out of the coach context — which is exactly
      // what `structurally_invariant` does today. A boolean cannot drift the way
      // a string-equality mirror does.
      //
      // Emitted ONLY as literal `true`, never `false`, matching the estate's
      // key-absence style: absence means "not an attested no-flip", which
      // includes both real flips and unresolved rows. It is deliberately NOT
      // the negation of `flip_value === null`.
      //
      // Safe to add TODAY (verified, not assumed) — see the PR body:
      // `EnrichmentFlipThresholdSchema` is `.passthrough()` and CEE's projection
      // reads named fields rather than spreading, so an unknown key is carried,
      // not rejected. Typing rides the queued @talchain/schemas 0.31.0.
      ...(isAttestedNoFlip(resolvedFlipValue, resolvedReason) ? { no_flip_in_range: true } : {}),
      ...(node?.observed_state?.unit !== undefined ? { unit: node.observed_state.unit } : {}),
    };

    rows.push(row);
    diagnostics.mapped++;
    if (resolvedReason === 'found') diagnostics.found++;
  }

  return { rows, diagnostics };
}

/**
 * Reduce ISL's OPEN `flip_reason` vocabulary to a token PLoT can publish,
 * without ever upgrading a row's confidence.
 *
 * The only rewrite performed is a DOWNGRADE: `'found'` with no usable
 * `flip_value` becomes {@link FOUND_WITHOUT_VALUE_REASON}. Every other token —
 * including ones this build has never seen — passes through verbatim, because
 * the vocabulary is open and the status classifier already files an unknown
 * null-valued reason as `unresolved` rather than asserting no-effect.
 */
function normaliseReason(
  reason: unknown,
  flipValue: number | null,
  diagnostics: FactorFlipMappingDiagnostics,
): string {
  if (!isNonEmptyString(reason)) return UNATTESTED_REASON;
  if (reason === 'found' && flipValue === null) {
    diagnostics.found_without_value++;
    return FOUND_WITHOUT_VALUE_REASON;
  }
  return reason;
}

/**
 * ISL reason tokens that ATTEST a factor cannot flip the winner. Kept in step
 * with `NO_EFFECT_REASONS` in `lib/flip-threshold-status.ts` — that module owns
 * the aggregate verdict, this one owns the per-row boolean, and both must agree
 * on what "attested" means.
 */
const ATTESTED_NO_FLIP_REASONS = new Set<string>([
  'no_effect_within_bounds',
  'structurally_invariant',
]);

/**
 * True when this row is a producer-ATTESTED no-flip — a proven or measured
 * "this factor cannot move the winner", not a row we merely failed to resolve.
 * An unresolved row (timeout, `candidate_cap_exceeded`, a producer
 * contradiction, an unknown token) is NOT attested and never carries the flag.
 */
function isAttestedNoFlip(flipValue: number | null, reason: string): boolean {
  return flipValue === null && ATTESTED_NO_FLIP_REASONS.has(reason);
}

/**
 * Resolve `direction` so that `direction === 'none'` ⟺ `flip_value === null`
 * holds on EVERY emitted row (review S3).
 *
 * Three producer states are handled, all counted:
 *
 * 1. **Usable token beside a real value** — emitted verbatim. If it disagrees
 *    with `sign(flip_value - current_value)` the disagreement is COUNTED but
 *    ISL's claim is NOT rewritten: the direction is the producer's to state,
 *    and silently "correcting" it would hide a real model disagreement.
 * 2. **Missing/non-token direction beside a real value** — DERIVED from
 *    `sign(flip_value - current_value)`. This is not an inference: `direction`
 *    is DEFINED as the way the factor must move from `current_value` to reach
 *    `flip_value`, so with both numbers in hand it is arithmetic. Counted so
 *    the producer gap stays visible.
 * 3. **Real value, no derivable direction** (`flip_value === current_value`, or
 *    a non-finite `current_value`) — DOWNGRADED: value nulled, reason set to
 *    {@link VALUE_WITHOUT_DIRECTION_REASON}, which the status classifier files
 *    as unresolved. Symmetric with the found-without-value downgrade, and the
 *    only case where a measurement is dropped — a flip that requires no
 *    movement is not a tipping point a consumer can act on.
 */
function resolveDirection(
  entry: ISLFactorFlipValueV2,
  flipValue: number | null,
  reason: string,
  diagnostics: FactorFlipMappingDiagnostics,
): { direction: 'increase' | 'decrease' | 'none'; flipValue: number | null; reason: string } {
  if (flipValue === null) {
    return { direction: NO_DIRECTION, flipValue: null, reason };
  }

  const current = entry.current_value;
  const delta = isFiniteNum(current) ? flipValue - current : Number.NaN;
  const derived: 'increase' | 'decrease' | null =
    Number.isFinite(delta) && delta !== 0 ? (delta > 0 ? 'increase' : 'decrease') : null;

  if (entry.direction === 'increase' || entry.direction === 'decrease') {
    if (derived !== null && derived !== entry.direction) {
      diagnostics.direction_disagrees_with_delta++;
    }
    return { direction: entry.direction, flipValue, reason };
  }

  if (derived !== null) {
    diagnostics.direction_derived++;
    return { direction: derived, flipValue, reason };
  }

  diagnostics.value_without_direction++;
  return { direction: NO_DIRECTION, flipValue: null, reason: VALUE_WITHOUT_DIRECTION_REASON };
}

function indexNodes(graph: EngineGraphV3 | undefined): Map<string, EngineNodeV3> | undefined {
  if (!graph || !Array.isArray(graph.nodes)) return undefined;
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function indexLabels(
  factorSensitivity: readonly FactorLabelSource[] | undefined,
): Map<string, string> | undefined {
  if (!Array.isArray(factorSensitivity)) return undefined;
  const map = new Map<string, string>();
  for (const f of factorSensitivity) {
    if (isNonEmptyString(f?.factor_id) && isNonEmptyString(f?.factor_label)) {
      map.set(f.factor_id, f.factor_label);
    }
  }
  return map;
}
