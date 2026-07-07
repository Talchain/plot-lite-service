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

export interface BoundaryContract {
  name: string;
  drops: string[];
  filtered: string[];
  renames: BoundaryRename[];
  transforms: BoundaryTransform[];
  enriched: string[];
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
      to: 'parameter_uncertainties[]',
      why: 'ISL needs explicit uncertainty specs; PLoT synthesises from observed values',
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
