/**
 * /v2/run top-level wire-contract key sets — the SINGLE SOURCE OF TRUTH shared
 * by the runtime (routes/v2/run.ts) and the OpenAPI↔runtime drift gate
 * (tests/contract/openapi-runtime-drift.test.ts).
 *
 * Derive-don't-mirror (F9 / D-23.15): the drift gate reads these constants and
 * the parsed `contracts/openapi.yaml`, and fails LOUD when the runtime request
 * allowlist or the ISL enrichment passthrough diverges from the documented
 * `runRequestV3` / `runResponseV3` components — so the two can never drift green
 * again (the exact defect that left `factor_correlations` + the correlated-
 * factors outputs undocumented while the runtime carried them).
 */

// Accepted TOP-LEVEL request keys for POST /v2/run. BOTH request gates read
// this: the preValidation unknown-key filter AND the Ajv body schema
// (additionalProperties:false) in run.ts. It MUST equal `runRequestV3.properties`
// in contracts/openapi.yaml — enforced by the drift gate.
export const V2_RUN_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'graph', 'options', 'goal_node_id',
  'seed', 'n_samples', 'detail_level', 'request_id', 'idempotency_key',
  'goal_threshold', 'brief', 'goal_constraints', 'include_thresholds',
  'include_e_values', 'include_voi', 'include_path_decomposition',
  // Capability #100 (doctrine D-23.4): client-supplied pairwise factor
  // correlations. BOTH gates must know this key — this allowlist (preValidation)
  // AND runV3Schema.properties (Ajv, additionalProperties:false). Omitting it
  // from either drops the field before it reaches the handler.
  'factor_correlations',
  // ⭐ ROADMAP 2.720 (pillar P4): the user's own stated ranges for factor
  // values. BOTH gates must know this key — this allowlist (preValidation) AND
  // runV3Schema.properties (Ajv, additionalProperties:false). Omitting it from
  // either drops the field before it reaches the handler, and the failure is
  // shaped like a 200.
  'user_stated_ranges',
]);

// ISL top-level correlated-factors ENRICHMENT outputs (capability #100 + VOI
// slices, D-23.8), forwarded VERBATIM from the ISL envelope when present. Each
// MUST be documented as a `runResponseV3` property — enforced by the drift gate.
// Order is the wire-emission order (preserved by islEnrichmentPassthrough).
export const ISL_TOPLEVEL_ENRICHMENT_KEYS = [
  'correlation_model',
  'decision_evpi',
  'factor_evppi',
  'p_win_sensitivity',
] as const;

/**
 * Additive passthrough of the ISL top-level enrichment fields. Present-in ⇒
 * present-out (verbatim); ABSENT ⇒ key omitted (no default payload growth,
 * every existing golden byte-identical). Guard is `!== undefined` so an explicit
 * null/0/false from ISL still passes through. Derives its key set (and their
 * emission order) from ISL_TOPLEVEL_ENRICHMENT_KEYS so the runtime and the drift
 * gate can never disagree about which keys are forwarded.
 */
export function islEnrichmentPassthrough(
  islResult: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!islResult) return out;
  for (const key of ISL_TOPLEVEL_ENRICHMENT_KEYS) {
    if (islResult[key] !== undefined) out[key] = islResult[key];
  }
  return out;
}
