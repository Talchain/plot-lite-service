/**
 * Lever-identity predicates — shared neutral leaf (A1b; D-U adopted 13 Jul).
 *
 * A factor with `zero_reason === 'intervention_override'` is an option-pinned
 * decision lever (the user controls its value via `options[i].interventions`),
 * NOT an independently tunable uncertainty driver. Tunability / evidence / VoI /
 * "what would change" surfaces must exclude such levers.
 *
 * D-U (ROADMAP 2.20/2.40) makes the STRUCTURAL union the canonical lever
 * definition: a factor that ANY option intervenes on is a lever, whether or
 * not ISL stamped it. ISL stamps `intervention_override` only for
 * elasticity≈0 first-option pins, so the stamp alone under-covers (live
 * fac_salary_cost case: pinned by a non-first option with nonzero measured
 * elasticity → arrived unstamped → PLoT published its sensitivity/EVPI while
 * coaching suppressed it as a lever). This module therefore carries BOTH
 * predicates — the request-side structural union
 * (`interventionTargetIdsFromOptions`) and the ISL-stamp symptom
 * (`isInterventionOverride`) — and the combined D-U predicate
 * (`isOptionControlledLever`). Every lever-identity consumer derives from
 * here — the /v2/run egress guards, the coaching layer
 * (normalise-inputs.ts), and, since the PR #219 review fixup, the M2
 * decision-review lane (request assembly, number-corrector input,
 * flip-candidate guard, legacy sensitive_parameters). Derive from here,
 * never inline.
 *
 * This module is the single definition, kept import-free so any layer (lib,
 * assembly, routes, coaching) can depend on it without creating an import
 * cycle. It does NOT read `source`, re-derive lever status from graph
 * topology, expose a public field, or define a new classification taxonomy.
 */

/** True iff the factor is an intervention-controlled lever (option-pinned). */
export function isInterventionOverride(f: { zero_reason?: string | null }): boolean {
  return f.zero_reason === 'intervention_override';
}

/**
 * Canonical identity of an ISL factor entry — ONE precedence, used EVERYWHERE
 * (Codex F13). ISL's canonical key is `node_id` (the graph node id); PLoT's
 * `factor_id` is the downstream alias. Precedence is **node_id-first**, matching
 * the factor_sensitivity mapper (`mapIslFactorEntry`, `run.ts`) and the
 * factor_stability publication (`buildFactorStability`, `factor-influence.ts`)
 * which both already resolve `node_id ?? factor_id`. The D-U lever predicate
 * (`isOptionControlledLever`) historically resolved the OPPOSITE way
 * (`factor_id ?? node_id`), so a future/additive twin `{node_id:'lever',
 * factor_id:'other'}` mapped/published as `lever` yet, resolving identity as
 * `other`, escaped lever-suppression. Everything now resolves identity through
 * this single helper.
 *
 * Returns `undefined` when neither id is a non-empty string.
 */
export function factorIdOf(
  f: { factor_id?: string | null; node_id?: string | null },
): string | undefined {
  const nodeId = typeof f.node_id === 'string' && f.node_id !== '' ? f.node_id : undefined;
  const factorId = typeof f.factor_id === 'string' && f.factor_id !== '' ? f.factor_id : undefined;
  return nodeId ?? factorId;
}

/**
 * True when an entry carries BOTH a non-empty `node_id` AND a non-empty
 * `factor_id` that DIFFER — an ambiguous twin whose canonical identity cannot
 * be trusted (Codex F13). Such an entry is dropped from lever-sensitive
 * publication surfaces and the drop is DISCLOSED on the wire
 * (`FACTOR_ID_CONFLICT`), never silently resolved to one of the two ids. The
 * pinned ISL producer emits only `node_id` today, so this is schema-evolution
 * hardening; it is additive and cannot fire on the current producer shape.
 */
export function hasFactorIdConflict(
  f: { factor_id?: string | null; node_id?: string | null },
): boolean {
  const nodeId = typeof f.node_id === 'string' && f.node_id !== '' ? f.node_id : undefined;
  const factorId = typeof f.factor_id === 'string' && f.factor_id !== '' ? f.factor_id : undefined;
  return nodeId !== undefined && factorId !== undefined && nodeId !== factorId;
}

/**
 * The canonical structural lever union (D-U): every factor id that ANY
 * option's `interventions` map targets. Source of truth is the request-side
 * `options[i].interventions`, NOT raw ISL `zero_reason` — ISL's stamp is a
 * downstream symptom rather than the canonical definition, and it misses
 * non-first-option pins with nonzero measured elasticity.
 *
 * Extracted verbatim from `src/coaching/normalise-inputs.ts` (which now
 * delegates here) so the coaching layer and the public
 * factor_sensitivity/EVPI egress share ONE union definition (ROADMAP 2.40).
 *
 * Plain-object guard: arrays are objects too and `Object.keys([])` returns
 * `["0","1",…]`, which would pollute the lever set with positional indices
 * for malformed inputs. The route schema enforces an object shape in
 * production, but this is cheap defence-in-depth.
 */
export function interventionTargetIdsFromOptions(
  options: ReadonlyArray<{ interventions?: unknown }> | undefined | null,
): Set<string> {
  const interventionTargetIds = new Set<string>();
  for (const opt of options ?? []) {
    const interventions = (opt as { interventions?: unknown }).interventions;
    if (
      interventions &&
      typeof interventions === 'object' &&
      !Array.isArray(interventions)
    ) {
      for (const factorId of Object.keys(interventions)) {
        interventionTargetIds.add(factorId);
      }
    }
  }
  return interventionTargetIds;
}

/**
 * Combined D-U lever predicate: a factor is an option-controlled lever when
 * ISL stamped it (`zero_reason === 'intervention_override'`) OR it is a
 * member of the structural union (`interventionTargetIdsFromOptions`).
 * Suppression surfaces (sensitivity/elasticity/VOI/EVPI) must use this — the
 * stamp alone under-covers (see module header).
 */
export function isOptionControlledLever(
  f: { factor_id?: string; node_id?: string; zero_reason?: string | null },
  structuralLeverIds?: ReadonlySet<string>,
): boolean {
  if (isInterventionOverride(f)) return true;
  // F13: resolve identity through the ONE canonical precedence (node_id-first),
  // identical to the factor_sensitivity mapper and factor_stability publication.
  const id = factorIdOf(f);
  return id != null && (structuralLeverIds?.has(id) ?? false);
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
      const id = factorIdOf(f); // F13: one canonical precedence everywhere.
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
