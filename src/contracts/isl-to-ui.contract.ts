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
    /** Top-level constraint value: ISL returns both threshold (primary) and value (computed); UI uses value. */
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
    'fragile_edges[].severity',          // B1: classified from switch_probability (>0.7→critical, >0.5→error, ≤0.5→warning)
    'robust_edges[].from_label',
    'robust_edges[].to_label',
    'factor_sensitivity[].source',       // Constant: 'isl'
    'factor_sensitivity[].confidence_source', // B (tier-B): 'plot_unified_from_isl_bootstrap' | 'plot_unified_from_graph' — honest provenance tag (audit A1-PRIMARY)
    'factor_sensitivity[].confidence_provenance', // B (tier-B): typed disclosure object {computation_source, formula_version, is_provisional, calibration_status, input_quality} — audit A1-PRIMARY
    'auto_noise_applied',                // B (tier-B): boolean echo of ISL's auto-noise flag — present on analysis_status ∈ {computed, partial}, null when ISL omits — audit B3
    'auto_noise_provenance',             // B (tier-B): analysis-level typed disclosure object {applied, effect, formula_version, multiplier, noise_distribution, filter_scope, is_provisional, calibration_status} — audit B3
    'recommended_option_id',
    'recommended_option_label',
    'near_tie',
    'confidence_tier',                   // B1: derived from m1_coaching.readiness (ready→strong, close_call→fair, else→needs_work)
    'dominant_factor',                   // B1: detected from factor_sensitivity (influence >0.5 AND ratio >2:1)
    // Tier-B always-emit contract: the following enrichment arrays are always
    // present on the response ([] when ISL returns empty or omits the field),
    // and their entries are label-enriched beyond the ISL source shape.
    'edge_e_values',                     // Always-emit: [] when absent/empty from ISL. Entries enriched with from_label, to_label, double-colon edge_id.
    'edge_e_values[].from_label',
    'edge_e_values[].to_label',
    'conditional_winners',               // Always-emit: [] when absent/empty from ISL. Entries enriched with factor_label, bucket winner_label.
    'conditional_winners[].factor_label',
    'conditional_winners[].low_bucket.winner_label',
    'conditional_winners[].high_bucket.winner_label',
    'flip_thresholds',                   // Always-emit: [] when absent/empty from ISL. Entries denormalised into factor/outcome units.
    'conditional_probabilities',         // Always-emit: [] when absent/empty (in constraint-analysis block). Index-based refs resolved to constraint_id strings.
  ],
} as const;
