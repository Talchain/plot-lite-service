/**
 * Track S — Display precision for surfaced win-probabilities (HELPER ONLY).
 *
 * ⚠️  NOT WIRED INTO THE RESPONSE. This module is a pure helper plus the
 *     recommendation derived from seed-sweep evidence. Per the Track S mandate,
 *     user-facing precision behaviour must not change without seed-sweep
 *     justification AND Neil/Jinghui sign-off on acceptable MC error. Wire this
 *     in only once that decision lands.
 *
 * ## Evidence (seed-sweep against live ISL, 12 seeds × {1000,2000,4000,8000})
 *
 * Winner win-probability spread (max − min across seeds), percentage points:
 *
 *   depth | clear-winner | near-tie | multi-option | constrained
 *   ------|--------------|----------|--------------|------------
 *   1000  |     3.05     |   5.35   |     6.57     |    5.85
 *   2000  |     1.90     |   2.70   |     3.92     |    4.08
 *   4000  |     1.19     |   1.84   |     2.54     |    2.24
 *   8000  |     1.19     |   1.15   |     1.70     |    1.51
 *
 * ISL already rounds win_probability to 0.01 (1 percentage point). The spread
 * above is *seed-to-seed* Monte Carlo variation at that display granularity
 * (ISL is bit-for-bit deterministic at a FIXED seed — verified separately).
 *
 * ## Rules encoded here
 *
 * 1. Display win-probabilities to whole percentage points (1pp). Anything finer
 *    (e.g. "84.2%") implies precision the simulation does not support at any of
 *    the tested depths.
 * 2. The displayed value carries an MC-uncertainty band. At the recommended
 *    4,000-sample depth the observed spread is ≤ ~3pp, so ±3pp is the default
 *    band. Below that depth the band widens (see DISPLAY_BANDS_BY_DEPTH).
 * 3. When the seed-to-seed spread exceeds ±5pp, OR two options are within the
 *    band of each other, suppress precise point/winner claims and present the
 *    comparison as "too close to call" (a genuine near-tie).
 *
 * These thresholds (±3pp ordinary, ±5pp fragile) are PROVISIONAL engineering
 * values. The open decision for Neil/Jinghui: "What MC error is acceptable for
 * displayed probabilities?" This is simulation-stability evidence, NOT calibration.
 */

/** Display granularity for win-probabilities, in percentage points. */
export const WIN_PROBABILITY_DISPLAY_PRECISION_PP = 1;

/** Spread (pp) at/under which an ordinary point display is considered honest. */
export const ORDINARY_DISPLAY_SPREAD_PP = 3;

/** Spread (pp) above which a result is "fragile" — suppress precise point claims. */
export const FRAGILE_SPREAD_PP = 5;

/**
 * Recommended MC-uncertainty band (± pp) to show alongside a point estimate, by
 * sample depth. Derived from the worst-case fixture spread at each depth, rounded
 * up to whole pp. Depths between table entries snap to the next-lower tabulated
 * depth (more conservative band).
 */
export const DISPLAY_BANDS_BY_DEPTH: ReadonlyArray<{ n_samples: number; band_pp: number }> = [
  { n_samples: 1000, band_pp: 7 },
  { n_samples: 2000, band_pp: 5 },
  { n_samples: 4000, band_pp: 3 },
  { n_samples: 8000, band_pp: 2 },
];

/** Round a probability (0..1) to the display granularity, returned as 0..1. */
export function roundWinProbabilityForDisplay(p: number): number {
  if (!Number.isFinite(p)) return p;
  const stepsPerUnit = 100 / WIN_PROBABILITY_DISPLAY_PRECISION_PP; // 100 for 1pp
  return Math.round(p * stepsPerUnit) / stepsPerUnit;
}

/** Format a probability (0..1) as a whole-percent string, e.g. 0.842 → "84%". */
export function formatWinProbability(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return `${Math.round(roundWinProbabilityForDisplay(p) * 100)}%`;
}

/** Recommended ± uncertainty band (pp) for a given resolved sample depth. */
export function recommendedDisplayBandPp(nSamples: number): number {
  let band = DISPLAY_BANDS_BY_DEPTH[0].band_pp;
  for (const row of DISPLAY_BANDS_BY_DEPTH) {
    if (nSamples >= row.n_samples) band = row.band_pp;
  }
  return band;
}

/**
 * Whether a precise point/winner claim should be suppressed in favour of a
 * "too close to call" presentation.
 *
 * @param observedSpreadPp seed-to-seed spread of the winner's win-probability (pp),
 *   when known from a sweep; pass undefined if not measured.
 * @param marginPp gap between the top two options' win-probabilities (pp).
 * @param nSamples resolved sample depth (used for the default band when margin given).
 */
export function shouldSuppressPointClaim(args: {
  observedSpreadPp?: number;
  marginPp?: number;
  nSamples?: number;
}): boolean {
  const { observedSpreadPp, marginPp, nSamples } = args;
  if (observedSpreadPp !== undefined && observedSpreadPp > FRAGILE_SPREAD_PP) return true;
  if (marginPp !== undefined) {
    const band = nSamples !== undefined ? recommendedDisplayBandPp(nSamples) : ORDINARY_DISPLAY_SPREAD_PP;
    if (marginPp <= band) return true; // options indistinguishable within the band
  }
  return false;
}
