/**
 * ISL → UI Boundary Transform Contract (B4.4)
 *
 * Declares all field drops, renames, enrichments, and structural transforms
 * applied by run.ts response assembly when constructing the UI-facing
 * RunResponseV3 from ISL analysis results.
 *
 * Both PLoT→ISL and ISL→UI are whitelist constructions (not passthrough).
 * This contract governs declared source fields — unknown ISL keys are NOT
 * expected to survive the boundary.
 */

import type { BoundaryContract } from './plot-to-isl.contract.js';

/**
 * ISL → UI boundary contract.
 *
 * Derived from: src/routes/v2/run.ts (buildResponse, transformEdgeSensitivity,
 *               transformFactorSensitivity, buildConstraintFields)
 *               src/integrations/isl/adapters/robustness-analysis.ts
 */
export const ISL_TO_UI_CONTRACT: BoundaryContract = {
  name: 'isl-to-ui',

  /** WHY dropped: superseded by richer fields or not in V3 schema. */
  drops: [
    'metadata.n_samples',            // Superseded by outcome.n_samples per-option
    'recommendation_confidence',     // Removed in V3 schema migration
  ],

  /** No structural filtering at this boundary (filtering happens at PLoT→ISL). */
  filtered: [],

  /** WHY renamed: UI schema uses different field names than ISL's response. */
  renames: [
    /** Array-level rename: ISL returns options[], UI exposes option_comparison[]. */
    { from: 'options', to: 'option_comparison' },
    /** ISL uses sensitivity[], UI uses edge_sensitivity[]. */
    { from: 'sensitivity', to: 'edge_sensitivity' },
    /** Factor identification: ISL uses node_id, UI uses factor_id. */
    { from: 'factor_sensitivity[].node_id', to: 'factor_sensitivity[].factor_id' },
    /** Factor label: ISL uses label, UI uses factor_label. */
    { from: 'factor_sensitivity[].label', to: 'factor_sensitivity[].factor_label' },
    /** Per-option constraint probability: ISL nests as joint_probability. */
    { from: 'constraint_analysis.joint_probability', to: 'probability_of_joint_goal' },
    /** Top-level constraint value: ISL uses threshold, UI uses value. */
    { from: 'constraint_results[].threshold', to: 'constraint_results[].value' },
    /** Top-level constraint probability: ISL uses prob_satisfied, UI uses probability. */
    { from: 'constraint_results[].prob_satisfied', to: 'constraint_results[].probability' },
  ],

  transforms: [
    {
      kind: 'derive',
      from: ['edge_from', 'edge_to'],
      to: 'edge_sensitivity[].edge_id',
      why: 'Composite key: "${edge_from}::${edge_to}" (double-colon canonical format)',
    },
    {
      kind: 'reshape',
      from: 'constraint_analysis.constraints[]',
      to: 'constraint_results[]',
      why: 'ISL nests per-option; UI extracts first option as canonical top-level array',
    },
    {
      kind: 'reshape',
      from: 'conditional_probabilities[].given_constraint_index',
      to: 'conditional_probabilities[].given_constraint_id',
      why: 'ISL uses index-based references; UI resolves to constraint_id strings',
    },
  ],

  /** WHY enriched: fields added during response assembly that ISL does not provide. */
  enriched: [
    'fragile_edges[].from_label',
    'fragile_edges[].to_label',
    'fragile_edges[].alternative_winner_label',
    'robust_edges[].from_label',
    'robust_edges[].to_label',
    'factor_sensitivity[].source',       // Constant: 'isl'
    'recommended_option_id',
    'recommended_option_label',
    'near_tie',
  ],
} as const;
