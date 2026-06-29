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

/**
 * Build the set of intervention-override (option-pinned lever) node ids from a
 * factor list. Used where the lever set must be derived from `zero_reason`
 * (e.g. decision-brief, which does not carry `interventionTargetIds`). Coaching
 * surfaces should prefer the canonical request-side `interventionTargetIds`.
 */
export function interventionOverrideFactorIds(
  factors: ReadonlyArray<{ factor_id?: string; node_id?: string; zero_reason?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const f of factors) {
    if (isInterventionOverride(f)) {
      const id = f.factor_id ?? f.node_id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * A1c: a fragile edge is "lever-sourced" when its SOURCE node is an
 * intervention-controlled lever. Naming such an edge in an action-guidance
 * surface ("what would change" / "could swing" / "validate the … assumption")
 * implies the user can tune/act on an option-pinned lever, which is false.
 * SOURCE-only by design: a lever as edge TARGET (`X → lever`) describes
 * something acting on the lever, not tuning it, so it is left untouched.
 */
export function isLeverSourcedEdge(fromId: string | undefined | null, leverIds: ReadonlySet<string>): boolean {
  return fromId != null && leverIds.has(fromId);
}

/**
 * Drop fragile edges whose SOURCE node is an intervention-override lever.
 * `getFromId` adapts the edge shape (raw `from_id` vs normalised `fromId`).
 * Empty lever set → returns the list unchanged.
 */
export function filterLeverSourcedFragileEdges<E>(
  edges: ReadonlyArray<E>,
  leverIds: ReadonlySet<string>,
  getFromId: (e: E) => string | undefined | null,
): E[] {
  if (leverIds.size === 0) return edges.slice();
  return edges.filter((e) => !isLeverSourcedEdge(getFromId(e), leverIds));
}
