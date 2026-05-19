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
  min_probe_margin: number | null;
  max_probe_margin: number | null;
  min_probe_delta: number | null;
  max_probe_delta: number | null;
  strongest_direction: MarginStrongestDirection;
  strongest_probe_value: number | null;
  value_scale: MarginValueScale;
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

function emptyResult(): MarginSensitivity {
  return {
    movement: 'none',
    threshold: MARGIN_MOVEMENT_THRESHOLD,
    baseline_leading_option_id: null,
    baseline_runner_up_option_id: null,
    baseline_margin: null,
    min_probe_margin: null,
    max_probe_margin: null,
    min_probe_delta: null,
    max_probe_delta: null,
    strongest_direction: 'none',
    strongest_probe_value: null,
    value_scale: 'normalised',
  };
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
    const out = emptyResult();
    if (args.strictFlipDetected) out.movement = 'flipped';
    return out;
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
      direction = 'none';
      probeValue = null;
    }
    return {
      movement: 'flipped',
      threshold: MARGIN_MOVEMENT_THRESHOLD,
      baseline_leading_option_id: leaderId,
      baseline_runner_up_option_id: runnerUpId,
      baseline_margin: baselineMargin,
      min_probe_margin: minMargin,
      max_probe_margin: maxMargin,
      min_probe_delta: minDelta,
      max_probe_delta: maxDelta,
      strongest_direction: direction,
      strongest_probe_value: probeValue,
      value_scale: 'normalised',
    };
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

  return {
    movement,
    threshold: MARGIN_MOVEMENT_THRESHOLD,
    baseline_leading_option_id: leaderId,
    baseline_runner_up_option_id: runnerUpId,
    baseline_margin: baselineMargin,
    min_probe_margin: minMargin,
    max_probe_margin: maxMargin,
    min_probe_delta: minDelta,
    max_probe_delta: maxDelta,
    strongest_direction: direction,
    strongest_probe_value: probeValue,
    value_scale: 'normalised',
  };
}
