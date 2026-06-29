/**
 * Intervention-override predicate — shared neutral leaf (A1b).
 *
 * A factor with `zero_reason === 'intervention_override'` is an option-pinned
 * decision lever (the user controls its value via `options[i].interventions`),
 * NOT an independently tunable uncertainty driver. Tunability / evidence / VoI /
 * "what would change" surfaces must exclude such levers.
 *
 * This module is the single definition, kept import-free so any layer (lib,
 * assembly, routes, coaching) can depend on it without creating an import cycle.
 * It keys ONLY on `zero_reason` — it does NOT read `source`, re-derive lever
 * status from graph topology or option interventions, expose a public field, or
 * define a new classification taxonomy.
 */

/** True iff the factor is an intervention-controlled lever (option-pinned). */
export function isInterventionOverride(f: { zero_reason?: string | null }): boolean {
  return f.zero_reason === 'intervention_override';
}

/** Drop intervention-controlled levers from a factor list. */
export function filterInterventionOverrides<T extends { zero_reason?: string | null }>(
  factors: T[],
): T[] {
  return factors.filter((f) => !isInterventionOverride(f));
}
