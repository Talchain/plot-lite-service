/**
 * Margin Sensitivity — Lead-margin diagnostic for flip-threshold probes.
 *
 * Computed from the same baseline/min/max probe results that the flip-threshold
 * binary search already fetches. No additional ISL calls.
 *
 * "Lead margin" = baseline leading option's win probability minus the strongest
 * alternative's win probability. Movement classifies whether the tested factor
 * range materially weakens, strengthens, flips, or fails to move the lead.
 *
 * Probability convention: decimals in [0, 1]. `MARGIN_MOVEMENT_THRESHOLD` is
 * provisional (5 percentage points, decimal 0.05) — not calibrated.
 *
 * ## Display-ready fields (architecture principle)
 *
 * DGAI is a thin display layer. PLoT owns scientific meaning. To stop DGAI
 * deriving percentage-point copy from raw `min_probe_delta` / `max_probe_delta`,
 * PLoT emits four display-ready fields directly:
 *
 *  - `strongest_delta`                    — signed decimal of the selected delta
 *  - `strongest_delta_abs`                — absolute value of the above
 *  - `strongest_delta_percentage_points`  — `abs * 100`, what DGAI shows
 *  - `display_value_available`            — true ONLY when `strongest_probe_value`
 *                                           is finite and has been denormalised
 *                                           to display units (value_scale ===
 *                                           'display'). DGAI must not render
 *                                           `strongest_probe_value` unless true.
 *
 * `min_probe_delta` and `max_probe_delta` remain for diagnostics; they are NOT
 * the field DGAI should display.
 *
 * Important: `strongest_probe_value` is the tested bound (or null when the
 * strict flip was found inside the interval by binary search). It is NOT the
 * exact flip threshold. The exact flip threshold remains `flip_value` on the
 * surrounding `flip_thresholds[]` entry.
 */

import type { FlipInferenceResult } from './flip-thresholds.js';

/**
 * Provisional minimum signed lead-margin movement, in probability decimals,
 * required to classify a probe as material. 0.05 = 5 percentage points.
 * Documented as provisional; not empirically calibrated.
 */
export const MARGIN_MOVEMENT_THRESHOLD = 0.05;

export type MarginMovement = 'none' | 'weakened' | 'strengthened' | 'flipped';
export type MarginStrongestDirection = 'towards_min' | 'towards_max' | 'both' | 'none';
export type MarginValueScale = 'normalised' | 'display';

export interface MarginSensitivity {
  movement: MarginMovement;
  threshold: number;
  baseline_leading_option_id: string | null;
  baseline_runner_up_option_id: string | null;
  baseline_margin: number | null;
  /** Raw diagnostic: lead margin at min bound. NOT for direct UI display. */
  min_probe_margin: number | null;
  /** Raw diagnostic: lead margin at max bound. NOT for direct UI display. */
  max_probe_margin: number | null;
  /** Raw diagnostic: min_probe_margin - baseline_margin. NOT for direct UI display. */
  min_probe_delta: number | null;
  /** Raw diagnostic: max_probe_margin - baseline_margin. NOT for direct UI display. */
  max_probe_delta: number | null;
  strongest_direction: MarginStrongestDirection;
  /**
   * Tested bound (or null) corresponding to `strongest_direction`. NOT the
   * exact flip threshold — that lives on `flip_value`. In normalised [0, 1]
   * until the denormaliser converts it to display units.
   */
  strongest_probe_value: number | null;
  value_scale: MarginValueScale;

  /**
   * Signed decimal margin delta corresponding to the selected strongest probe.
   * Negative ⇒ baseline leading option's margin weakened.
   * Positive ⇒ baseline leading option's margin strengthened.
   * Null when `movement === 'none'` or no finite delta is available.
   */
  strongest_delta: number | null;
  /** Absolute value of `strongest_delta`. Null when above is null. */
  strongest_delta_abs: number | null;
  /**
   * `strongest_delta_abs * 100`. The display-ready percentage-point value
   * DGAI should render. Finite or null. Not aggressively rounded here —
   * UI house style does the rounding.
   */
  strongest_delta_percentage_points: number | null;
  /**
   * True ONLY when `strongest_probe_value` is finite AND `value_scale ===
   * 'display'` (i.e. the denormaliser converted it against a valid factor
   * context). DGAI must not render `strongest_probe_value` unless true.
   */
  display_value_available: boolean;
}

export interface ComputeMarginSensitivityArgs {
  baseline: FlipInferenceResult;
  min: FlipInferenceResult;
  max: FlipInferenceResult;
  /**
   * True if the binary search (or a bound probe) already established a strict
   * winner flip for this factor. Forces `movement: 'flipped'`.
   */
  strictFlipDetected: boolean;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Identify leading option and strongest alternative from a probe.
 * Returns null pair if probe has <2 valid options.
 */
function topTwo(
  options: ReadonlyArray<{ option_id: string; win_probability: number }>,
): { leader: { id: string; p: number }; runnerUp: { id: string; p: number } } | null {
  const valid = options.filter(
    (o) => typeof o.option_id === 'string' && o.option_id.length > 0 && isFiniteNumber(o.win_probability),
  );
  if (valid.length < 2) return null;

  // Deterministic ordering: primary by win_probability desc, secondary by option_id asc.
  const sorted = [...valid].sort((a, b) => {
    if (b.win_probability !== a.win_probability) return b.win_probability - a.win_probability;
    return a.option_id < b.option_id ? -1 : a.option_id > b.option_id ? 1 : 0;
  });
  return {
    leader: { id: sorted[0].option_id, p: sorted[0].win_probability },
    runnerUp: { id: sorted[1].option_id, p: sorted[1].win_probability },
  };
}

/**
 * Margin at a probe for a fixed baseline-leading option.
 * = baseline_leading.win_probability_at_probe - max(other options' win_probability_at_probe)
 * Returns null if data is missing/invalid. Negative when the baseline leader is
 * no longer the strongest at this probe (a bound-level flip).
 */
function marginAtProbeForLeader(
  probe: FlipInferenceResult,
  baselineLeadingOptionId: string,
): { margin: number; leaderProb: number; strongestOtherId: string | null } | null {
  if (!probe || !Array.isArray(probe.options)) return null;

  let leaderProb: number | undefined;
  let strongestOtherProb = -Infinity;
  let strongestOtherId: string | null = null;

  for (const opt of probe.options) {
    if (!opt || typeof opt.option_id !== 'string' || !isFiniteNumber(opt.win_probability)) {
      continue;
    }
    if (opt.option_id === baselineLeadingOptionId) {
      leaderProb = opt.win_probability;
    } else if (
      opt.win_probability > strongestOtherProb ||
      (opt.win_probability === strongestOtherProb &&
        strongestOtherId !== null &&
        opt.option_id < strongestOtherId)
    ) {
      strongestOtherProb = opt.win_probability;
      strongestOtherId = opt.option_id;
    }
  }

  if (!isFiniteNumber(leaderProb) || strongestOtherId === null || !isFiniteNumber(strongestOtherProb)) {
    return null;
  }
  return { margin: leaderProb - strongestOtherProb, leaderProb, strongestOtherId };
}

/**
 * Select the signed strongest delta given movement, direction, and the raw
 * min/max deltas. Returns null when no finite signal exists.
 *
 * Selection rules (mirrors `strongest_direction` / `strongest_probe_value`):
 *  - 'none'        → null  (movement is 'none')
 *  - 'towards_min' → min_probe_delta when finite, else null
 *  - 'towards_max' → max_probe_delta when finite, else null
 *  - 'both'        → side with the larger |delta| (ties → min for determinism)
 *
 * For `movement === 'flipped'` with `strongest_direction === 'none'` (strict
 * flip found inside the interval by binary search — neither bound probe
 * flipped on its own), still pick the larger-|delta| finite bound if any, so
 * DGAI has a useful magnitude. This does NOT imply the exact flip threshold.
 */
function selectStrongestSignedDelta(
  movement: MarginMovement,
  direction: MarginStrongestDirection,
  minDelta: number | null,
  maxDelta: number | null,
): number | null {
  if (movement === 'none') return null;

  const haveMin = isFiniteNumber(minDelta);
  const haveMax = isFiniteNumber(maxDelta);

  if (direction === 'towards_min') return haveMin ? minDelta : null;
  if (direction === 'towards_max') return haveMax ? maxDelta : null;

  if (direction === 'both') {
    if (haveMin && haveMax) {
      return Math.abs(minDelta as number) >= Math.abs(maxDelta as number)
        ? (minDelta as number)
        : (maxDelta as number);
    }
    if (haveMin) return minDelta;
    if (haveMax) return maxDelta;
    return null;
  }

  // direction === 'none' — only reachable for movement === 'flipped' via
  // interior binary-search strict flip. Pick the larger-|delta| finite bound.
  if (movement === 'flipped') {
    if (haveMin && haveMax) {
      return Math.abs(minDelta as number) >= Math.abs(maxDelta as number)
        ? (minDelta as number)
        : (maxDelta as number);
    }
    if (haveMin) return minDelta;
    if (haveMax) return maxDelta;
  }
  return null;
}

function buildResult(args: {
  movement: MarginMovement;
  leaderId: string | null;
  runnerUpId: string | null;
  baselineMargin: number | null;
  minMargin: number | null;
  maxMargin: number | null;
  minDelta: number | null;
  maxDelta: number | null;
  direction: MarginStrongestDirection;
  probeValue: number | null;
}): MarginSensitivity {
  const strongestDelta = selectStrongestSignedDelta(
    args.movement,
    args.direction,
    args.minDelta,
    args.maxDelta,
  );
  const strongestDeltaAbs = strongestDelta !== null ? Math.abs(strongestDelta) : null;
  const strongestDeltaPp = strongestDeltaAbs !== null ? strongestDeltaAbs * 100 : null;

  return {
    movement: args.movement,
    threshold: MARGIN_MOVEMENT_THRESHOLD,
    baseline_leading_option_id: args.leaderId,
    baseline_runner_up_option_id: args.runnerUpId,
    baseline_margin: args.baselineMargin,
    min_probe_margin: args.minMargin,
    max_probe_margin: args.maxMargin,
    min_probe_delta: args.minDelta,
    max_probe_delta: args.maxDelta,
    strongest_direction: args.direction,
    strongest_probe_value: args.probeValue,
    // The helper always emits 'normalised'. The denormaliser may stamp
    // 'display' (and set display_value_available=true) if it converts
    // strongest_probe_value against a valid factor context.
    value_scale: 'normalised',
    strongest_delta: strongestDelta,
    strongest_delta_abs: strongestDeltaAbs,
    strongest_delta_percentage_points: strongestDeltaPp,
    display_value_available: false,
  };
}

function emptyResult(movementOverride?: MarginMovement): MarginSensitivity {
  return buildResult({
    movement: movementOverride ?? 'none',
    leaderId: null,
    runnerUpId: null,
    baselineMargin: null,
    minMargin: null,
    maxMargin: null,
    minDelta: null,
    maxDelta: null,
    direction: 'none',
    probeValue: null,
  });
}

/**
 * Classify lead-margin movement across the three Step-0 probes.
 *
 * Rules:
 *  - If `strictFlipDetected` is true, or either probe margin is negative (a
 *    bound-level flip already happened), movement is 'flipped'.
 *  - Otherwise, with both deltas finite: pick the larger |delta|. If it is
 *    below `MARGIN_MOVEMENT_THRESHOLD`, movement is 'none'; if the larger-
 *    |delta| direction has negative sign, movement is 'weakened'; positive
 *    sign, 'strengthened'.
 *  - `strongest_direction` is 'both' when both bounds exceed threshold with
 *    opposite signs, else the side that exceeds threshold, else 'none'.
 */
export function computeMarginSensitivity(args: ComputeMarginSensitivityArgs): MarginSensitivity {
  const baselineTop = topTwo(args.baseline?.options ?? []);
  if (!baselineTop) {
    // Cannot identify a baseline leader / runner-up. Still surface flip status
    // (when known) so downstream classifier behaves correctly.
    return emptyResult(args.strictFlipDetected ? 'flipped' : 'none');
  }

  const leaderId = baselineTop.leader.id;
  const runnerUpId = baselineTop.runnerUp.id;
  const baselineMargin = baselineTop.leader.p - baselineTop.runnerUp.p;

  const minAt = marginAtProbeForLeader(args.min, leaderId);
  const maxAt = marginAtProbeForLeader(args.max, leaderId);

  const minMargin = minAt ? minAt.margin : null;
  const maxMargin = maxAt ? maxAt.margin : null;
  const minDelta = minMargin !== null ? minMargin - baselineMargin : null;
  const maxDelta = maxMargin !== null ? maxMargin - baselineMargin : null;

  // Strict flip path: caller already detected a winner change, or a bound
  // probe shows the baseline leader is no longer the strongest there.
  const minIsBoundFlip = minMargin !== null && minMargin < 0;
  const maxIsBoundFlip = maxMargin !== null && maxMargin < 0;
  if (args.strictFlipDetected || minIsBoundFlip || maxIsBoundFlip) {
    let direction: MarginStrongestDirection = 'none';
    let probeValue: number | null = null;
    if (minIsBoundFlip && maxIsBoundFlip) {
      direction = 'both';
      // Pick the side with the larger absolute delta when both flip.
      const absMin = minDelta !== null ? Math.abs(minDelta) : -Infinity;
      const absMax = maxDelta !== null ? Math.abs(maxDelta) : -Infinity;
      probeValue = absMin >= absMax ? 0 : 1;
    } else if (minIsBoundFlip) {
      direction = 'towards_min';
      probeValue = 0;
    } else if (maxIsBoundFlip) {
      direction = 'towards_max';
      probeValue = 1;
    } else {
      // strictFlipDetected set by caller (binary-search/grid-fallback path).
      // Direction is recorded elsewhere on the FlipDiagnostics; leave 'none'.
      // strongest_delta still populated from larger-|delta| bound below.
      direction = 'none';
      probeValue = null;
    }
    return buildResult({
      movement: 'flipped',
      leaderId,
      runnerUpId,
      baselineMargin,
      minMargin,
      maxMargin,
      minDelta,
      maxDelta,
      direction,
      probeValue,
    });
  }

  // Non-flip classification: compare |min_delta|, |max_delta| against threshold.
  const minMaterial = minDelta !== null && Math.abs(minDelta) >= MARGIN_MOVEMENT_THRESHOLD;
  const maxMaterial = maxDelta !== null && Math.abs(maxDelta) >= MARGIN_MOVEMENT_THRESHOLD;

  let movement: MarginMovement = 'none';
  let direction: MarginStrongestDirection = 'none';
  let probeValue: number | null = null;

  if (minMaterial || maxMaterial) {
    const absMin = minDelta !== null ? Math.abs(minDelta) : -Infinity;
    const absMax = maxDelta !== null ? Math.abs(maxDelta) : -Infinity;
    // Use sign of the larger-|delta| side for movement classification.
    const dominantDelta = absMin >= absMax ? minDelta : maxDelta;
    movement = (dominantDelta ?? 0) < 0 ? 'weakened' : 'strengthened';

    if (minMaterial && maxMaterial) {
      const sameSign =
        minDelta !== null && maxDelta !== null && Math.sign(minDelta) === Math.sign(maxDelta);
      if (sameSign) {
        direction = absMin >= absMax ? 'towards_min' : 'towards_max';
        probeValue = absMin >= absMax ? 0 : 1;
      } else {
        direction = 'both';
        probeValue = absMin >= absMax ? 0 : 1;
      }
    } else if (minMaterial) {
      direction = 'towards_min';
      probeValue = 0;
    } else {
      direction = 'towards_max';
      probeValue = 1;
    }
  }

  return buildResult({
    movement,
    leaderId,
    runnerUpId,
    baselineMargin,
    minMargin,
    maxMargin,
    minDelta,
    maxDelta,
    direction,
    probeValue,
  });
}
