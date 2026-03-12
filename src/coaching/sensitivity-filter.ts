/**
 * Sensitivity Filter — intervention_override exclusion
 *
 * Factors with zero_reason === 'intervention_override' are decision levers,
 * not uncertainty drivers. They should not appear in sensitivity output sent
 * to the review prompt or the UI.
 *
 * This is a PLoT output filter only — ISL request/response is not mutated.
 */

/**
 * Filter out factor sensitivity entries that represent intervention overrides.
 * These are decision levers (elasticity=0 because the user controls them),
 * not uncertainty drivers.
 *
 * @param factors Array of factor sensitivity entries with optional zero_reason
 * @returns Filtered array excluding intervention_override entries
 */
export function filterInterventionOverrides<T extends { zero_reason?: string | null }>(
  factors: T[]
): T[] {
  return factors.filter((f) => f.zero_reason !== 'intervention_override');
}
