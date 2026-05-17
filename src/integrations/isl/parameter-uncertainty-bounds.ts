/**
 * Bounds and defaults for `parameter_uncertainties[].std` emitted to ISL.
 *
 * Shared by the V3 translator (`buildParameterUncertaintiesV3`) and the
 * V1/V2 preflight builder (`buildParameterUncertainties`) so the two paths
 * stay in lockstep.
 *
 * Priority order (both paths):
 *   1. User-supplied `observed_state.std` (clamped to [MIN_USER_STD, MAX_USER_STD]).
 *   2. Binary-factor default (BINARY_DEFAULT_STD).
 *   3. Value-based default for non-zero continuous factors
 *      (|value| × VALUE_BASED_STD_FRACTION, floored at DEFAULT_STD_FLOOR).
 *   4. Fallback for zero-valued continuous factors (FALLBACK_STD).
 *
 * The DEFAULT_STD_FLOOR applies ONLY to synthesised defaults (priorities
 * 2–4). User-supplied values are honoured down to MIN_USER_STD; the floor
 * never silently widens what the user told us.
 *
 * Distinct from CONSTRAINT_PINNED_STD in `constraint-pu-injection.ts`,
 * which is a constraint-evaluation safety net for nodes that arrive at the
 * injection step without a PU entry.
 */

/** Hard lower bound for user-supplied std. Prevents literal-zero degeneracy in ISL Monte Carlo. */
export const MIN_USER_STD = 1e-4;

/** Hard upper cap for user-supplied std. Prevents extreme values from destabilising ISL. */
export const MAX_USER_STD = 2.0;

/** Floor applied to synthesised default std (priorities 2–4). Ensures meaningful sensitivity. */
export const DEFAULT_STD_FLOOR = 0.1;

/** Default std for binary factors (range [0, 1] or labelled yes/no). */
export const BINARY_DEFAULT_STD = 0.3;

/** Fraction of |value| used as the synthesised default for non-zero continuous factors. */
export const VALUE_BASED_STD_FRACTION = 0.15;

/** Fallback std when no user value, not binary, and value is exactly 0. */
export const FALLBACK_STD = 0.5;
