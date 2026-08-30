/**
 * PLoT → ISL Boundary Transform Contract (B4.4)
 *
 * Declares all field drops, renames, flattening, and structural transforms
 * applied by translator-v3.ts when constructing an ISL robustness request
 * from the PLoT-normalised graph and options.
 *
 * Both PLoT→ISL and ISL→UI are whitelist constructions (not passthrough).
 * This contract governs declared source fields — unknown keys are NOT
 * expected to survive the boundary.
 */

export interface BoundaryRename {
  from: string;
  to: string;
}

export interface BoundaryTransform {
  kind: 'flatten' | 'derive' | 'reshape';
  /** Source field path(s). string[] for multi-source transforms. */
  from: string | string[];
  to: string;
  why: string;
}

/**
 * A SUBSTITUTION: the boundary keeps the producer's field NAME but replaces its
 * VALUE with a locally-computed quantity, and does not publish the producer's.
 *
 * Added by lane PLoT importance-authority (25 Jul 2026) because this category
 * was not representable before, and so went undeclared for six months: a
 * substitution is neither a `drop` (the key is still on the wire), nor a
 * `rename` (the name is unchanged), nor an `enrichment` (the producer DID send
 * a value — it was discarded). That is precisely the shape a consumer cannot
 * detect, which is why it needs its own name in the contract.
 *
 * Every substitution MUST name a `disclosed_by` field on the wire, so a consumer
 * can tell at runtime which quantity it is holding.
 */
export interface BoundarySubstitution {
  /** The wire field whose name is the producer's and whose value is not. */
  field: string;
  /** What the producer sent under this name. */
  producer_quantity: string;
  /** What the boundary publishes under this name instead. */
  published_quantity: string;
  /** When the substitution applies (e.g. only on a given source path). */
  when: string;
  /** The wire field a consumer reads to know which quantity it holds. */
  disclosed_by: string;
  why: string;
}

export interface BoundaryContract {
  name: string;
  drops: string[];
  filtered: string[];
  renames: BoundaryRename[];
  transforms: BoundaryTransform[];
  enriched: string[];
  /** Producer-name / local-value collisions. See `BoundarySubstitution`. */
  substitutions?: BoundarySubstitution[];
  /**
   * Keys this boundary STILL sends that the consumer does not declare, kept
   * deliberately and with a named reason.
   *
   * Added by the contract step-2 slice-6 lane (26 Jul 2026). Before it, a key
   * the consumer did not declare had no representation here at all: it was
   * neither a `drop` (it is on the wire) nor `enriched` (that means "added by
   * PLoT", not "unknown to the reader"), so an undeclared key was
   * indistinguishable from an oversight — which is exactly how
   * `parameter_uncertainties[].mean` survived unnoticed for months. An entry
   * here is a commitment to resolve, not a licence to keep.
   */
  knownUndeclared?: string[];
}

/**
 * PLoT → ISL boundary contract.
 *
 * Derived from: src/integrations/isl/translator-v3.ts
 *               src/normalisation/option-filter.ts
 *               src/normalisation/constraint-filter.ts
 */
export const PLOT_TO_ISL_CONTRACT: BoundaryContract = {
  name: 'plot-to-isl',

  /** WHY dropped: UI-only metadata not needed by ISL's causal engine. */
  drops: [
    'detail_level',
    'idempotency_key',
    'brief',
    'intervention.source',  // InterventionValueV3.source stripped in toISLInterventions()

    // ---------------------------------------------------------------------
    // Contract step-2 slice 6 — keys PLoT USED TO SEND that ISL never declared.
    // Each was silently discarded by ISL's `extra: "ignore"`, so it looked like
    // contract and behaved like nothing. Verified against the pinned ISL model
    // (Talchain/Inference-Service-Layer @ 7d144c7f): replaying all five captured
    // live request fixtures with and without these keys yields a BYTE-IDENTICAL
    // `RobustnessRequestV2.model_dump()`.
    // ---------------------------------------------------------------------

    // ISL's ParameterUncertainty (robustness_v2.py:254-267) declares
    // {node_id, distribution, std, range_min, range_max}. The sampling centre
    // comes from the node's observed_state.value
    // (robustness_analyzer_v2.py:852-855, 891-892, 3490-3494), never from here.
    'parameter_uncertainties[].mean',

    // ISL's EdgeV2 (robustness_v2.py:348-426) declares no `weight`. PLoT's
    // coefficient already reaches ISL in the declared location, strength.mean.
    // Was sent on the /v1/run leg (integrations/isl/index.ts, analyseRobustness).
    'graph.edges[].weight',

    // PLoT-internal: attached by graph-normaliser.ts:274-276 so
    // constraint-compiler.ts can read `.operator` off the NORMALISED PLoT graph.
    // ISL's ObservedState (robustness_v2.py:160-200) does not declare it. Was
    // reaching the wire because toISLNode forwarded observed_state VERBATIM;
    // now projected through toISLObservedState().
    'nodes[].observed_state.metadata',
  ],

  /**
   * KNOWN-UNDECLARED, DELIBERATELY STILL SENT — declare these here rather than
   * let them look like an oversight. Dropped by ISL today.
   *
   * - `goal_constraints[].weight` (translator-v3.ts): caller-supplied and
   *   omitted unless provided; latent on the golden path. Still undeclared
   *   upstream; resolve with its own adopt-or-drop decision.
   *
   * ── RETIRED — `goal_constraints[].constraint_id` (contract step-2 slice 6b) ──
   * ISL DECLARES it as of @0316098b, so the exemption is no longer true and is
   * removed rather than left to rot. Codex adjudicated OQ-5 as ADOPT-into-ISL
   * reader-first, not delete, because `constraint_verdict`'s
   * `identity_unresolved` state needs a stable constraint identity to cite.
   * That sequence is now complete on both halves: ISL accepts + echoes it
   * (slice 6b, ISL PR #115), and PLoT READS the echo (this change — see
   * routes/v2/constraint-identity.ts). This list is checked by
   * tests/isl-request-drift-pairing.contract.test.ts against ISL's own pinned
   * request models, which fails loud if an entry goes stale in EITHER
   * direction — so leaving it here would have turned red on the next pin bump.
   */
  knownUndeclared: [
    'goal_constraints[].weight',
  ],

  /** WHY filtered: non-causal scaffolding nodes that ISL cannot process. */
  filtered: [
    'nodes[kind=option]',
    'nodes[kind=decision]',
    // Note: constraint nodes are NOT in NON_CAUSAL_NODE_KINDS at runtime.
    // option-filter.ts comments mention constraint, but the constant is ['option', 'decision'].
    // If constraint filtering is added in the future, add 'nodes[kind=constraint]' here.
    'edges[incident_to_filtered_nodes]',
  ],

  /** F-20: value→threshold rename removed — ISL canonical field is now "value". */
  renames: [],

  transforms: [
    {
      kind: 'flatten',
      from: 'options[].interventions (Record<string, InterventionValueV3>)',
      to: 'options[].interventions (Record<string, number>)',
      why: 'ISL expects flat numeric interventions; .source metadata is UI-only',
    },
    {
      kind: 'derive',
      from: ['nodes[].observed_state.value', 'nodes[].observed_state.std'],
      to: 'parameter_uncertainties[] (distribution: normal)',
      why: 'ISL needs explicit uncertainty specs; PLoT synthesises from observed values',
    },
    {
      kind: 'derive',
      from: ['nodes[].prior.range_min', 'nodes[].prior.range_max'],
      to: 'parameter_uncertainties[] (distribution: uniform)',
      why:
        'A factor whose only quantitative statement is a `prior` has no ' +
        'observed_state, and ISL reads a NORMAL entry\'s centre from observed_state.value ' +
        '(defaulting to 0.0). Only the uniform family carries its centre on the wire, so ' +
        'the declared support is forwarded verbatim as range_min/range_max. Sending a ' +
        'width-only normal here parsed cleanly and sampled the factor outside its own ' +
        'stated support — measured, and pinned in tests/isl-factor-sampler-centre.contract.test.ts.',
    },
  ],

  /** WHY enriched: fields added by PLoT that do not exist in the upstream request. */
  enriched: [
    'request_id',
    'analysis_types',
    'parameter_uncertainties[].distribution',
    // Lane PLoT-W4: conditional forward — sent as `true` ONLY when the inbound
    // /v2/run request set include_path_decomposition: true; the key is OMITTED
    // otherwise (request-gated opt-in, no default ISL payload growth).
    'include_path_decomposition (conditional opt-in forward)',
  ],
} as const;
