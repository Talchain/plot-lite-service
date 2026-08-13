/**
 * Request Canonicalisation for Determinism Hash
 *
 * Computes a response_hash from the canonical form of the request.
 * Only SEMANTIC fields that affect inference results are included.
 *
 * Key principle: Same semantic request → same hash, regardless of:
 * - Option order
 * - Node labels/descriptions
 * - Field ordering in objects
 *
 * @see P0-PLOT-5: Determinism Hash with Full Numeric Normalisation
 *
 * ## BREAKING CHANGE (v2)
 *
 * Hash version 2 introduces breaking changes that invalidate all existing hashes:
 *
 * 1. **Precision increase**: DECIMAL_PRECISION changed from 6 to 12 decimals
 *    - Previous: 0.123456 → 0.123456
 *    - Current:  0.123456 → 0.123456000000
 *    - Impact: Prevents float rounding issues at high precision
 *
 * 2. **Intercept field inclusion**: Node `intercept` now included in hash
 *    - Previous: intercept ignored
 *    - Current:  intercept included (defaults to 0.0 if absent)
 *    - Impact: Nodes with intercept values produce different hashes
 *
 * 3. **Hash version prefix**: Version number is now part of canonical form
 *    - Ensures version changes are detectable
 *
 * **Migration**: Clients caching by response_hash must invalidate caches
 * when upgrading to this version. Hash collisions between v1 and v2 are
 * impossible due to the version prefix in the canonical form.
 *
 * ## BREAKING CHANGE (v3)
 *
 * Hash version 3 adds goal_constraints to the canonical form:
 *
 * 1. **goal_constraints inclusion**: Constraints now affect the hash
 *    - Previous: Two requests with different goal_constraints produced same hash
 *    - Current:  goal_constraints sorted by constraint_id, value normalised to 12dp
 *    - Impact: Requests with goal_constraints produce different hashes from v2
 *
 * **Migration**: ALL hashes change from v2 due to the version prefix bump (v2→v3).
 * Non-constraint requests have an identical canonical form to v2 except for
 * the version field, but still produce different hashes. Cache invalidation required.
 *
 * ## BREAKING CHANGE (v4)
 *
 * Hash version 4 adds identifiability assessment to the canonical form:
 *
 * 1. **identifiability inclusion**: Identifiability status now affects the hash
 *    - Previous: Two graphs with different identifiability produced same hash
 *    - Current:  identifiability { status, pairs_checked, pairs_identifiable } included
 *    - Impact: ALL hashes change due to version prefix bump (v3→v4)
 *
 * **Migration**: ALL hashes change from v3. Cache invalidation required.
 * Identifiability is a deterministic function of graph structure (backdoor criterion),
 * so it does not introduce non-determinism into the hash.
 *
 * ## BREAKING CHANGE (v5)
 *
 * Hash version 5 adds `factor_stability` to the canonical form:
 *
 * 1. **factor_stability inclusion**: ISL stability assessment per factor (3C bootstrap)
 *    - Sorted by factor_id for determinism
 *    - Includes elasticity_std, attribution_stability, rank_flip_rate, stability_method
 *    - Empty array when ISL provides no 3C data (still included in canonical form)
 *    - Impact: ALL hashes change due to version prefix bump (v4→v5)
 *
 * **Migration**: ALL hashes change from v4. Cache invalidation required.
 * factor_stability is deterministic ISL output (bootstrap analysis),
 * so it does not introduce non-determinism into the hash.
 *
 * ## BREAKING CHANGE (v6)
 *
 * Hash version 6 removes ISL-derived fields from the canonical form:
 *
 * 1. **identifiability removed**: Was ISL bootstrap output — same request can produce
 *    different identifiability if ISL changes bootstrap internals. Excluding it ensures
 *    the hash is deterministic from the request alone.
 * 2. **factor_stability removed**: Same reason — ISL bootstrap output, not request-derived.
 *    - Impact: ALL hashes change due to version prefix bump (v5→v6)
 *
 * **Migration**: ALL hashes change from v5. Cache invalidation required.
 * The `identifiability` and `factorStability` parameters are retained in
 * `canonicaliseRequest` and `hashRequest` for API backwards compatibility
 * but are no longer included in the hash input.
 *
 * ## BREAKING CHANGE (v7)
 *
 * Hash version 7 adds the resolved Monte Carlo sample depth to the canonical form:
 *
 * 1. **n_samples inclusion**: The resolved `n_samples` (request value, or the
 *    server default when omitted) now contributes to the hash. Monte Carlo error
 *    scales with sample depth, so the same graph + same seed at a different
 *    `n_samples` is a genuinely different computation and MUST hash differently.
 *    - An omitted `n_samples` resolves to the server default before hashing, so
 *      an explicit default-valued request and an omitted one share a hash.
 *    - Impact: ALL hashes change due to version prefix bump (v6→v7).
 *
 * **Migration**: ALL hashes change from v6. Cache invalidation required. Old
 * stored facts/responses keep their v6 hashes (namespaced by the `version`
 * field); this change does not rewrite history — new runs emit v7.
 * `n_samples` is request-derived and deterministic, consistent with the v6
 * principle that the hash is computable from the request alone.
 *
 * ## AMENDMENT (v7, ROADMAP 2.919 — baseline inclusion, NO version bump)
 *
 * `observed_state.baseline` now participates in the canonical form,
 * presence-conditionally (finite numbers only; absent/null contribute no key):
 *
 * 1. **Why it must be in the hash**: baseline is a computation input. ISL
 *    converts a `'level'` goal threshold via
 *    `threshold − goal_baseline + goal_intercept` (see translator-v3.ts,
 *    where `baseline` is called out as LOAD-BEARING on
 *    `ISL_DECLARED_OBSERVED_STATE_FIELDS`) and evaluates goal_constraints
 *    against change-from-baseline samples — so the goal baseline already
 *    changes `probability_of_goal`. Two requests differing only in a
 *    baseline were sharing a response_hash, which defeats the UI's
 *    run-identity gates (dedupe + dirty-overlay clearing compare hashes).
 *
 * 2. **Why NO version bump (deliberate, not forgotten)**: a bump puts the
 *    new version number in EVERY canonical form and flips every stored
 *    hash. A presence-conditional key bounds the flip instead: an absent
 *    baseline contributes no key, so every baseline-free request
 *    canonicalises BYTE-IDENTICALLY to pre-amendment v7 and keeps its
 *    hash. Only baseline-BEARING requests change — and the live producer
 *    writes none today (the 2.281 witness; CEE 2.877 begins minting
 *    `observed_state.baseline` after this lands, which is why this must
 *    land first). Collision safety without the bump: no pre-amendment
 *    canonical form ever contained a `baseline` key, so no new
 *    baseline-bearing form can collide with any old form.
 *
 * 3. **Semantics**: absent is NOT coerced to 0 — a stated baseline of 0
 *    and no baseline are different computations (ISL refuses a `'level'`
 *    threshold as `missing_goal_baseline` when absent). Values are
 *    12dp-normalised like every other float in the form.
 *
 * Guarded by tests/hash-baseline-awareness.test.ts; the bounded-flip
 * byte-stability is witnessed by tests/isl-v2-golden-response.pin.test.ts
 * (baseline-free live capture, pinned hash unchanged).
 */

import { createHash } from 'node:crypto';
import type { RunRequestV3, OptionV3, EngineGraphV3, IdentifiabilityAssessment, FactorStabilityEntry } from '../types/engine-v3.js';
import { STANDARD_N_SAMPLES_DEFAULT } from '../config/sampling.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Hash version to prevent collisions when canonicalisation changes */
export const HASH_VERSION = 8;

/**
 * ISL-request keys that are NOT part of the computation and must not enter the
 * hash. A DENYLIST on purpose (ROADMAP 2.1024): an allowlist is the
 * hand-maintained mirror this whole change exists to abolish — a field added to
 * the ISL request would silently stay out of the hash, which is exactly the
 * v1–v7 defect. With a denylist, a new ISL field enters the hash automatically.
 *
 * Drift direction, stated as a BOUND rather than an absolute: for any field
 * whose value is a JSON primitive, array or plain object — which is every field
 * on the ISL request today — an unlisted non-deterministic field destabilises
 * the hash into a CACHE MISS, i.e. a false "changed", never a false "unchanged".
 * That is the safe direction and the reason a denylist is acceptable here where
 * an allowlist is not.
 *
 * ⚠ THE GUARANTEE IS NOT UNCONDITIONAL, AND THE EXCEPTION IS WORTH NAMING.
 * `canonicaliseDeep` walks own enumerable keys, so a value carrying a `toJSON`
 * (a `Date`, a `Decimal`, a class instance with no own enumerable fields)
 * canonicalises to `{}` while `JSON.stringify` puts its real content on the
 * wire. Two materially different requests would then hash the SAME — a false
 * "unchanged", the wrong direction. **Not reachable today:** the ISL request is
 * assembled from plain JSON throughout. It becomes reachable the moment a
 * non-plain value is introduced into it, so treat that as the trigger to revisit
 * this, not as a theoretical aside.
 */
const NON_DETERMINISTIC_ISL_KEYS = new Set(['request_id']);

/**
 * ISL-request keys whose ARRAY ORDER IS SEMANTIC and must therefore survive
 * canonicalisation unsorted (ROADMAP 2.1026).
 *
 * `options` is the only member today, and it is here for a measured reason:
 * ISL derives edge sensitivity, factor sensitivity and fragile-edge
 * classification from `options[0]` and discloses it as
 * `sensitivity_reference_option_id`, which reaches the user. Two requests whose
 * options differ only in ORDER are therefore DIFFERENT COMPUTATIONS and must
 * hash differently.
 *
 * ⚠ THIS IS A HAND-MAINTAINED LIST, WITH THE SAFE POLARITY. A set-like array
 * wrongly listed here costs cache hits; an ORDERED array wrongly OMITTED is a
 * false "unchanged" — the defect class this file exists to close. So the bar for
 * adding is low and the bar for removing is high: removing a key asserts that
 * ISL treats that array as unordered, which needs evidence from ISL's bytes, not
 * from its field name.
 */
const ORDER_SIGNIFICANT_ISL_KEYS = new Set(['options']);

/**
 * Fallback Monte Carlo sample depth used when canonicalising a request whose
 * `n_samples` is omitted and no resolved depth is passed by the caller.
 *
 * Anchored to the compile-time standard default (`STANDARD_N_SAMPLES_DEFAULT`,
 * PR-E: 4000) — NOT the env-resolved value — so canonical hashing stays
 * deterministic and environment-independent. The live route always passes the
 * resolved depth explicitly, so this fallback only affects direct callers/tests.
 */
export const DEFAULT_HASH_N_SAMPLES = STANDARD_N_SAMPLES_DEFAULT;

/** Number of decimal places for float normalisation */
const DECIMAL_PRECISION = 12;

// -----------------------------------------------------------------------------
// Float Normalisation
// -----------------------------------------------------------------------------

/**
 * Normalise a float to fixed precision.
 * Ensures 0.5 and 0.500000 produce identical hash.
 */
function normaliseFloat(n: number): number {
  return parseFloat(n.toFixed(DECIMAL_PRECISION));
}

/**
 * Canonicalise an optional number for hashing.
 * - undefined/null => 0.0
 * - -0 => 0
 * - fixed precision to avoid float drift
 */
function canonicaliseNumber(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0.0;
  if (!Number.isFinite(value)) return 0.0;
  if (Object.is(value, -0)) return 0;
  return normaliseFloat(value);
}


// -----------------------------------------------------------------------------
// Effective ISL request canonicalisation (v8)
// -----------------------------------------------------------------------------

/**
 * Canonicalise the EFFECTIVE ISL request — the bytes PLoT actually sends to the
 * compute layer — into a deterministic, order-insensitive form.
 *
 * WHY THIS EXISTS (ROADMAP 2.1024). Up to v7 the hash was computed from a
 * PARALLEL SEMANTIC PROJECTION of the inbound request: a hand-maintained list of
 * fields someone had to remember to extend. It drifted, exactly as the estate's
 * dominant defect predicts. Measured at `b9f6b5a7`, four analysis-changing
 * fields were absent from it — the goal frame, the constraint frame, node prior
 * bounds/distribution, and factor correlations — so a request changing ALL FOUR
 * produced a byte-identical hash while producing a materially different ISL
 * request and a different answer. "Unchanged" was a lie.
 *
 * The fix is structural rather than another field: anything that changes what
 * ISL computes must, by construction, change the ISL request. Hashing that
 * request therefore cannot omit a computation input, because an input that
 * reached ISL without appearing here does not exist.
 *
 * ⚠ IT IS A SUPERSET, NOT A REPLACEMENT — SAY SO, BECAUSE THE SHORT VERSION IS
 * WRONG (ROADMAP 2.1027). On the `isl_v3` class the canonical form carries the
 * effective ISL request **in addition to** the retained inbound projection
 * (graph, options, goal_threshold, goal_constraints); it does not replace it.
 * Describing this as "hashes the ISL request instead of a projection" is false
 * and was corrected here after a probe refuted it: two runs whose raw
 * intervention values differ (60000 vs 90000) but which CLAMP to the same wire
 * value produced **byte-identical ISL requests and DIFFERENT hashes**.
 *
 * That is the intended behaviour, and the reason is that this hash keys a
 * RESPONSE, not only a computation. The response echoes raw, pre-normalisation
 * quantities (`original_value`, repair records, disclosed inputs), so two runs
 * with an identical ISL request can still produce different response bodies.
 * Dropping the projection would let a consumer serve one run's body for
 * another's inputs.
 *
 * The two directions, stated plainly:
 *   · a change that reaches ISL ALWAYS moves the hash        — no false "unchanged";
 *   · a change that does NOT reach ISL may ALSO move it      — a conservative
 *     false "changed", costing a cache miss.
 * The first is the correctness property; the second is the safe direction to err
 * in. `T-superset` in the route suite pins exactly this, so the behaviour is
 * deliberate rather than incidental.
 *
 * ORDER HANDLING — AND `options` IS NOT A SET (ROADMAP 2.1026).
 * Object keys are sorted recursively. Arrays are sorted by their canonical
 * serialisation **except** the ones named in {@link ORDER_SIGNIFICANT_ISL_KEYS}.
 *
 * ⚠ AN EARLIER VERSION OF THIS COMMENT CLAIMED EVERY ARRAY HERE IS A SET. THAT
 * WAS FALSE, AND THE FALSE CLAIM WAS LOAD-BEARING. `options[0]` is
 * SEMANTICALLY PRIVILEGED: ISL computes edge sensitivity, factor sensitivity and
 * fragile-edge classification against the FIRST option and discloses it as
 * `sensitivity_reference_option_id`, which PLoT surfaces to the user
 * (`engine-v3.ts` — "uses the first option in the request";
 * `isl-types.ts:272-273,1196`). Nothing sorts options before the translator, so
 * the caller's order IS the order ISL sees.
 *
 * PROVEN BY EXECUTION at this tip: reordering two options handed ISL a genuinely
 * different reference option (intervention `0.9` vs `0.2`) while the v8 hash was
 * byte-identical — precisely the defect this canonicaliser exists to close,
 * surviving in a different field. It is PRE-EXISTING (v1–v7 sorted options too,
 * explicitly by id), so it is not a regression — but sorting them here would
 * have shipped a false justification for it, and the test would have pinned the
 * blind spot as if it were a guarantee.
 *
 * These ARE sets, and are sorted: `graph.nodes` and `graph.edges` (ISL keys them
 * by id / by endpoints), `goal_constraints` (keyed by `constraint_id`),
 * `parameter_uncertainties` (keyed by `node_id`), `factor_correlations` (an
 * unordered pair set), `user_stated_ranges` (keyed by member) and
 * `analysis_types`. For those, sorting keeps the v1–v7 guarantee that member
 * order is not semantic, without naming a field to sort by.
 */
function canonicaliseDeep(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Object.is(value, -0)) return 0;
    return normaliseFloat(value);
  }
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    // Sort by canonical serialisation so member ORDER cannot change the hash.
    return value
      .map(canonicaliseDeep)
      .sort((a, b) => {
        const sa = JSON.stringify(a) ?? '';
        const sb = JSON.stringify(b) ?? '';
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    // `undefined` is absent, not a value — JSON.stringify drops it anyway, and
    // materialising it as null would make an omitted key differ from itself.
    if (v === undefined) continue;
    out[key] = canonicaliseDeep(v);
  }
  return out;
}

/**
 * Strip the non-deterministic keys, then canonicalise deeply.
 * Exported for the gate test that pins the denylist's effect.
 */
export function canonicaliseISLRequest(islRequest: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(islRequest).sort()) {
    if (NON_DETERMINISTIC_ISL_KEYS.has(key)) continue;
    const value = islRequest[key];
    if (value === undefined) continue;

    if (ORDER_SIGNIFICANT_ISL_KEYS.has(key) && Array.isArray(value)) {
      // Canonicalise each MEMBER (so their object keys sort and floats
      // normalise) while leaving the ARRAY's order exactly as ISL will read it.
      out[key] = value.map(canonicaliseDeep);
      continue;
    }
    out[key] = canonicaliseDeep(value);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Canonical Node
// -----------------------------------------------------------------------------

interface CanonicalNode {
  id: string;
  kind: string;
  intercept: number;
  epsilon_std: number;
  observed_state?: {
    value: number;
    std?: number;
    /** 2.919: computation input (ISL level-threshold conversion + change-from-baseline framing). Presence-conditional — absent contributes no key. */
    baseline?: number;
  };
}

/**
 * Extract only semantic fields from a node.
 * Excludes: label, description, and other UI metadata.
 */
function canonicaliseNode(node: EngineGraphV3['nodes'][0]): CanonicalNode {
  const canonical: CanonicalNode = {
    id: node.id,
    kind: node.kind,
    intercept: canonicaliseNumber((node as any).intercept),
    epsilon_std: (node as any).epsilon_std ?? 0,
  };

  if (node.observed_state && node.observed_state.value !== undefined) {
    canonical.observed_state = {
      value: normaliseFloat(node.observed_state.value),
    };

    // Include std if present (some nodes have observed_state.std)
    const std = (node.observed_state as any).std;
    if (std !== undefined) {
      canonical.observed_state.std = normaliseFloat(std);
    }

    // 2.919 (v7 amendment): include baseline if present — it is a computation
    // input (ISL level-threshold conversion `threshold − goal_baseline +
    // goal_intercept`, change-from-baseline constraint framing), so two
    // requests differing only in a baseline must hash differently.
    // Presence-conditional AND finite-guarded: absent/null/non-finite
    // contribute no key, so every baseline-free request keeps its exact
    // pre-amendment hash (bounded flip — see the header). Absent is NOT
    // coerced to 0: baseline 0 and no baseline are different computations.
    const baseline = (node.observed_state as any).baseline;
    if (typeof baseline === 'number' && Number.isFinite(baseline)) {
      canonical.observed_state.baseline = normaliseFloat(baseline);
    }
  }

  return canonical;
}

// -----------------------------------------------------------------------------
// Canonical Edge
// -----------------------------------------------------------------------------

interface CanonicalEdge {
  from: string;
  to: string;
  strength: {
    mean: number;
    std: number;
  };
  exists_probability: number;
}

/**
 * Extract only semantic fields from an edge.
 * Excludes: label, provenance, and other UI metadata.
 */
function canonicaliseEdge(edge: EngineGraphV3['edges'][0]): CanonicalEdge {
  return {
    from: edge.from,
    to: edge.to,
    strength: {
      mean: normaliseFloat(edge.strength.mean),
      std: normaliseFloat(edge.strength.std),
    },
    exists_probability: normaliseFloat(edge.exists_probability),
  };
}

// -----------------------------------------------------------------------------
// Canonical Option
// -----------------------------------------------------------------------------

interface CanonicalOption {
  id: string;
  interventions: Record<string, number>;
}

/**
 * Extract only semantic fields from an option.
 * Excludes: label (which is UI-only).
 *
 * Supports both intervention formats:
 * - Simple: { "node_id": 10 }
 * - Rich: { "node_id": { "value": 10, "source": "user" } }
 */
function canonicaliseOption(option: OptionV3): CanonicalOption {
  // Sort intervention keys alphabetically
  const sortedInterventions: Record<string, number> = {};
  const sortedKeys = Object.keys(option.interventions).sort();

  for (const key of sortedKeys) {
    const intervention = option.interventions[key] as number | { value: number };
    // Handle both simple numbers and rich objects
    const value = typeof intervention === 'number' ? intervention : intervention.value;
    sortedInterventions[key] = normaliseFloat(value);
  }

  return {
    id: option.id,
    interventions: sortedInterventions,
  };
}

// -----------------------------------------------------------------------------
// Canonical Request
// -----------------------------------------------------------------------------

interface CanonicalConstraint {
  constraint_id: string;
  node_id: string;
  operator: string;
  value: number;
}

interface CanonicalRequest {
  version: number;
  /**
   * Which computation this hash describes (v8). Named on purpose so the two
   * classes can never be mistaken for one another: `isl_v3` is hashed from the
   * EFFECTIVE ISL request, `pre_isl` from the inbound projection because no ISL
   * request was built (ISL disabled, or an early return before the call). Two
   * different questions must not share one answer under one field name.
   */
  computation_class: 'isl_v3' | 'pre_isl';
  /** The effective ISL request, canonicalised. Null on the `pre_isl` class. */
  isl_request: unknown;
  seed: string;
  /** Resolved Monte Carlo sample depth (v7) — affects MC error of all surfaced numbers */
  n_samples: number;
  goal_node_id: string;
  detail_level: string;
  /** Goal threshold affects probability_of_goal computation */
  goal_threshold?: number;
  /** Goal constraints affect joint probability computation (v3) */
  goal_constraints?: CanonicalConstraint[];
  graph: {
    nodes: CanonicalNode[];
    edges: CanonicalEdge[];
  };
  options: CanonicalOption[];
  // NOTE (v6): identifiability and factor_stability removed from hash input.
  // These are ISL-derived fields — the same request + same seed can produce different
  // values if ISL changes its bootstrap internals. Excluding them ensures the hash
  // is deterministic from the request alone.
}

/**
 * Build a canonical representation of the request.
 * Includes only request-derived semantic fields that affect inference results.
 *
 * Sorting rules:
 * - Nodes sorted by id
 * - Edges sorted by (from, to)
 * - Options sorted by id
 * - Intervention keys sorted alphabetically
 *
 * @param req V2 run request
 * @param normalizedGraph Normalized graph (post-normalisation)
 * @param seedUsed Seed that will be used (already normalised to string)
 * @param _identifiability Unused since v6 — retained for API backwards compatibility
 * @param _factorStability Unused since v6 — retained for API backwards compatibility
 * @param nSamples Resolved Monte Carlo sample depth (v7). When omitted, falls back
 *   to `req.n_samples`, then to `DEFAULT_HASH_N_SAMPLES`, so callers that have
 *   already applied the route default should pass it explicitly.
 * @returns Canonical JSON string
 */
export function canonicaliseRequest(
  req: RunRequestV3,
  normalizedGraph: EngineGraphV3,
  seedUsed: string,
  _identifiability?: IdentifiabilityAssessment,
  _factorStability?: FactorStabilityEntry[],
  nSamples?: number,
  islRequest?: Record<string, unknown>
): string {
  // v7: resolve the sample depth the same way the route does, so an omitted
  // n_samples and an explicit default-valued one canonicalise identically.
  const resolvedNSamples =
    nSamples ??
    (typeof req.n_samples === 'number' && Number.isFinite(req.n_samples)
      ? req.n_samples
      : DEFAULT_HASH_N_SAMPLES);
  const canonical: CanonicalRequest = {
    version: HASH_VERSION,
    computation_class: islRequest !== undefined ? 'isl_v3' : 'pre_isl',
    isl_request: islRequest !== undefined ? canonicaliseISLRequest(islRequest) : null,
    seed: seedUsed,
    n_samples: resolvedNSamples,
    goal_node_id: req.goal_node_id,
    detail_level: req.detail_level ?? 'standard',
    graph: {
      // Sort nodes by id
      nodes: [...normalizedGraph.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(canonicaliseNode),
      // Sort edges by (from, to). Exclude bidirected edges — they are trust
      // annotations that don't affect inference results (ISL never sees them).
      edges: [...normalizedGraph.edges]
        .filter((e) => e.edge_type !== 'bidirected')
        .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
        .map(canonicaliseEdge),
    },
    // Sort options by id
    options: [...req.options]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(canonicaliseOption),
  };

  // Include goal_threshold in hash if provided (affects probability_of_goal computation)
  // Treat null as absent (not included in hash)
  if (typeof req.goal_threshold === 'number' && Number.isFinite(req.goal_threshold)) {
    canonical.goal_threshold = canonicaliseNumber(req.goal_threshold);
  }

  // CIL C2: Include goal_constraints in hash (v3)
  // Different constraints produce different results, so must produce different hashes.
  // Sort by constraint_id for determinism. Absent/empty constraints produce no hash contribution.
  const constraints = req.goal_constraints;
  if (Array.isArray(constraints) && constraints.length > 0) {
    canonical.goal_constraints = [...constraints]
      .sort((a, b) => a.constraint_id.localeCompare(b.constraint_id))
      .map(c => ({
        constraint_id: c.constraint_id,
        node_id: c.node_id,
        operator: c.operator,
        value: canonicaliseNumber(c.value),
      }));
  }

  // NOTE (v6): identifiability and factor_stability are NOT included in the hash.
  // They are ISL-derived fields that can vary independently of the request.
  // Excluding them ensures hash determinism from request alone.

  return JSON.stringify(canonical);
}

/**
 * Compute the response hash from a canonicalised request.
 *
 * @param canonicalised JSON string from canonicaliseRequest
 * @returns 16-character hex hash
 */
export function computeResponseHash(canonicalised: string): string {
  return createHash('sha256').update(canonicalised).digest('hex').slice(0, 16);
}

/**
 * Convenience function: canonicalise and hash in one call.
 *
 * @param req V2 run request
 * @param normalizedGraph Normalized graph (post-normalisation)
 * @param seedUsed Seed that will be used (already normalised to string)
 * @param identifiability Optional identifiability assessment
 * @param factorStability Optional ISL stability assessment per factor
 * @param nSamples Resolved Monte Carlo sample depth (v7); see canonicaliseRequest
 * @returns 16-character hex hash
 */
export function hashRequest(
  req: RunRequestV3,
  normalizedGraph: EngineGraphV3,
  seedUsed: string,
  identifiability?: IdentifiabilityAssessment,
  factorStability?: FactorStabilityEntry[],
  nSamples?: number,
  islRequest?: Record<string, unknown>
): string {
  const canonical = canonicaliseRequest(req, normalizedGraph, seedUsed, identifiability, factorStability, nSamples, islRequest);
  return computeResponseHash(canonical);
}
