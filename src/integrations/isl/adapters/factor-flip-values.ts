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
    const direction: 'increase' | 'decrease' | 'none' =
      flipValue !== null && (entry.direction === 'increase' || entry.direction === 'decrease')
        ? entry.direction
        : NO_DIRECTION;

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
      flip_value: flipValue,
      flip_reason: reason,
      // `alternative_winner_id` is meaningful ONLY beside a real flip value.
      // ISL already nulls it otherwise; this re-asserts the invariant so a
      // future producer bug cannot name a winner for a flip that never happens.
      alternative_winner_id:
        flipValue !== null && isNonEmptyString(entry.alternative_winner_id)
          ? entry.alternative_winner_id
          : null,
      // Closed form: no bisection, no probes. Both are 0 by CONSTRUCTION here,
      // not "unknown" — the values are algebraic, so any non-zero count would
      // be a fiction about how they were obtained.
      iterations_used: 0,
      probes_used: 0,
      direction,
      ...(node?.observed_state?.unit !== undefined ? { unit: node.observed_state.unit } : {}),
    };

    rows.push(row);
    diagnostics.mapped++;
    if (reason === 'found') diagnostics.found++;
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
