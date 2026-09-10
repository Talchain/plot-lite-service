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
    // ── Lane PLoT importance-authority (25 Jul 2026) — PREVIOUSLY UNDECLARED ──
    // These six were dropped by the transforms but appeared nowhere in this
    // list, which read as complete. A contract that lists 3 of 9 drops is worse
    // than none. Declared here as a statement of FACT about today's wire; see
    // ROADMAP row "PLoT: restore or rename the dropped ISL factor/edge
    // measurements" for the decision on whether to stop dropping them.
    //
    // `FactorSensitivityResultV3` has no `importance_score` member at all, so
    // this is dropped on BOTH paths — graph-primary AND the ISL-only fallback.
    // It has never been on the wire.
    //
    // ⭐ UPDATED — family-4 slice 0, 2026-07-27. This entry used to end
    // "(`src/facts/mapper.ts` SYNTHESISES one from the already-substituted PLoT
    // row; that is not a passthrough.)" — an accurate confession of a live
    // defect: the drop was declared here while a same-named field WAS in fact
    // emitted, one level down, inside `fact_objects[].data`. That synthesis has
    // been REMOVED (`mapFactorSensitivity`), so the drop is now true of the
    // whole /v2/run body rather than of `factor_sensitivity[]` alone.
    'factor_sensitivity[].importance_score',
    // ISL's own MC uncertainty-importance ordering. On the graph-primary path
    // the published `factor_sensitivity[].importance_rank` is PLoT's own
    // lever-aware ordering over graph influence, NOT this value — see the
    // `substitutions` block below and the per-row `importance_basis` disclosure.
    'factor_sensitivity[].importance_rank (ISL value, on the graph-primary path)',
    // Same: ISL's MC-derived values are replaced by graph-derived quantities
    // under the identical field names on the graph-primary path.
    'factor_sensitivity[].sensitivity_score (ISL value, on the graph-primary path)',
    'factor_sensitivity[].elasticity (ISL value, on the graph-primary path)',
    'factor_sensitivity[].direction (ISL value, on the graph-primary path)',
    // `EdgeSensitivityResultV3` has no `sensitivity_score` or `direction`
    // member. transformEdgeSensitivity keeps elasticity/importance_rank/
    // sensitivity_type/interpretation and drops these two on every path.
    'edge_sensitivity[].sensitivity_score',
    'edge_sensitivity[].direction',
    // Producer honesty (lane PLoT-H item B, 2026-07-07): ISL derives this as
    // option_wins[winner]/n_samples — the leader's win_probability relabelled,
    // zero independent information (verified byte-identical live: 0.59025 /
    // 0.8541875). The UI printed it as a fabricated "N% stability" statistic.
    // Absence is honest; the UI has an absence path.
    //
    // KNOWN COLLISION (ROADMAP 1.211, 2026-07-26). ISL PR #114 made
    // `robustness.confidence` carry this SAME quantity, unmodified
    // (robustness_analyzer_v2.py:2739 `return recommendation_stability`). So
    // the number withheld here is still forwarded under `confidence`, a name
    // implying calibration that ISL's own field description now denies. PLoT
    // forwards `confidence_basis` beside it so a consumer can branch, but the
    // duplication itself is a cross-repo contract question — whether the slot
    // should survive, or whether ISL's honestly-named field should be
    // delivered instead — and is not settled unilaterally by this lane.
    'robustness.recommendation_stability',
  ],

  /**
   * Conditional structural filtering (producer honesty, lane PLoT-H item A):
   * per-option `constraint_analysis.joint_probability` → probability_of_joint_goal
   * and `constraints[].prob_satisfied` → constraint_probabilities are SUPPRESSED
   * for the whole run when any constraint target is unreliable (default-range
   * threshold normalisation and/or ISL CONSTRAINT_NODE_DEFAULT_BASE on the
   * target node). Marked by the WARNING-severity CONSTRAINT_TARGET_UNRELIABLE
   * inference warning; raw values stay in diagnostics logs only.
   *
   * Doctrine B exception (lane P0-C2, ratified 2026-07-07): when the ONLY
   * unreliability reason is the defaulted base AND the target node is
   * forward-propagated (≥1 directed incoming edge), the fields are DELIVERED
   * with an additive per-option `goal_fit_basis` provenance annotation
   * ({ scored_from: 'modelled_outcome_distribution', node_ids }) and an
   * info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS note instead of the
   * warning.
   *
   * Top-level mirror (lane 27, ROADMAP 1.26a — the LANE25 §8 follow-up): the
   * TOP-LEVEL block built by buildConstraintFields (constraint_results[]
   * .probability, constraint_diagnostics, conditional_probabilities) is gated
   * by the SAME partition — on a suppressed run the whole block is withheld
   * and constraints_status reports 'unavailable' instead of a fabricated
   * 'computed'; doctrine-B modelledBasis targets deliver it unchanged.
   * @see src/lib/constraint-reliability.ts
   */
  filtered: [
    'constraint_analysis.joint_probability (when CONSTRAINT_TARGET_UNRELIABLE)',
    'constraint_analysis.constraints[].prob_satisfied (when CONSTRAINT_TARGET_UNRELIABLE)',
    'constraint_results[] / constraint_diagnostics[] / conditional_probabilities[] (top-level block, when CONSTRAINT_TARGET_UNRELIABLE — constraints_status: unavailable)',
  ],

  /** WHY renamed: UI schema uses different field names than ISL's response. */
  renames: [
    /** Array-level rename: ISL returns options[], UI exposes option_comparison[]. */
    { from: 'options', to: 'option_comparison' },
    /**
     * Live V2 wire (ISL build 9a22a1a+, lane PLoT-W4): edge sensitivity is
     * NESTED at robustness.edge_sensitivity; UI exposes flat edge_sensitivity[].
     * (The V1-era top-level sensitivity[] rename below is legacy-fixture only.)
     */
    { from: 'robustness.edge_sensitivity', to: 'edge_sensitivity' },
    /** LEGACY (fixtures only): V1-era ISL top-level sensitivity[] → edge_sensitivity[]. */
    { from: 'sensitivity', to: 'edge_sensitivity' },
    /** Factor identification: ISL uses node_id, UI uses factor_id. */
    { from: 'factor_sensitivity[].node_id', to: 'factor_sensitivity[].factor_id' },
    /** Factor label: ISL uses label, UI uses factor_label. */
    { from: 'factor_sensitivity[].label', to: 'factor_sensitivity[].factor_label' },
    /**
     * Edge endpoints (lane PLoT importance-authority, 25 Jul 2026 — previously
     * UNDECLARED). Live V2 ISL entries carry from_id/to_id; the UI shape uses
     * bare from/to. Only the composite `edge_id` derive was declared before.
     */
    { from: 'robustness.edge_sensitivity[].from_id', to: 'edge_sensitivity[].from' },
    { from: 'robustness.edge_sensitivity[].to_id', to: 'edge_sensitivity[].to' },
    /** Per-option constraint probability: ISL nests as joint_probability. */
    { from: 'constraint_analysis.joint_probability', to: 'probability_of_joint_goal' },
    /** Top-level constraint value: ISL returns both threshold (primary) and value (computed); UI uses value. */
    { from: 'constraint_results[].threshold', to: 'constraint_results[].value' },
    /** Top-level constraint probability: ISL uses prob_satisfied, UI uses probability. */
    { from: 'constraint_results[].prob_satisfied', to: 'constraint_results[].probability' },
  ],

  /**
   * Producer-name / local-value collisions on `factor_sensitivity[]`.
   *
   * `/v2/run` makes GRAPH-derived factor sensitivity PRIMARY and ISL the
   * FALLBACK (`src/routes/v2/run.ts`, commit `f6f7255`, 22 Jan 2026 — a
   * deliberate, long-standing precedence, rationale: the graph path uses edge
   * path analysis and has no dependency on `parameter_uncertainties`). The
   * merge (`mergeIslConfidenceIntoGraphFactors`) carries over ISL's bootstrap
   * STABILITY DIAGNOSTICS only (`attribution_stability`, `elasticity_std`,
   * `rank_flip_rate`, `stability_method`, `value_*`).
   *
   * The collision: the graph values are published under ISL's field names, so
   * on the live wire `sensitivity_score`/`elasticity`/`direction`/
   * `importance_rank` all LOOK like ISL measurements and are not. Verified
   * against the checked-in capture+golden pair
   * (`tests/fixtures/isl-v2-live-20260707/`) and against a live
   * plot-lite-service-staging call on build `1dd45b6`.
   *
   * `importance_rank` is additionally LEVER-AWARE (not a raw graph index):
   * option-controlled levers are ordered last. See
   * `src/lib/importance-authority.ts`.
   */
  substitutions: [
    {
      field: 'factor_sensitivity[].importance_rank',
      producer_quantity: "ISL Monte-Carlo uncertainty importance (ordered by its own sensitivity_score/importance_score)",
      published_quantity: "PLoT lever-aware ordering over graph path-analysis influence (option-controlled levers ordered last)",
      when: "graph-primary path (importance_basis === 'graph_structural'), i.e. every live response where the graph path returns factors",
      disclosed_by: 'factor_sensitivity[].importance_basis',
      why: 'Graph-derived factor sensitivity is PRIMARY (f6f7255). ISL rank is not published; the graph ordering carries the ISL field name.',
    },
    {
      field: 'factor_sensitivity[].sensitivity_score',
      producer_quantity: 'ISL MC sensitivity score (0-1, normalised to max)',
      published_quantity: 'graph raw total causal effect (FactorInfluence.influence) — 0 for option-controlled levers (LEVER_SUPPRESSION_FIELDS)',
      when: "graph-primary path (importance_basis === 'graph_structural')",
      disclosed_by: 'factor_sensitivity[].importance_basis',
      why: 'Same precedence choice; different quantity, same name.',
    },
    {
      field: 'factor_sensitivity[].elasticity',
      producer_quantity: 'ISL MC elasticity (outcome units per factor unit, signed)',
      published_quantity: 'graph normalised influence (equal to influence_score) — 0 for option-controlled levers',
      when: "graph-primary path (importance_basis === 'graph_structural')",
      disclosed_by: 'factor_sensitivity[].importance_basis',
      why: 'Same precedence choice. NOTE the units differ from ISL elasticity — do not compare across the two bases.',
    },
    {
      field: 'factor_sensitivity[].direction',
      producer_quantity: 'sign of ISL MC elasticity',
      published_quantity: 'sign of the graph path-product influence',
      when: "graph-primary path (importance_basis === 'graph_structural')",
      disclosed_by: 'factor_sensitivity[].importance_basis',
      why: 'Same precedence choice. The two can disagree (live: fac_dev_headcount ISL negative, published positive).',
    },
  ],

  transforms: [
    {
      kind: 'derive',
      from: ['from_id', 'to_id'],
      to: 'edge_sensitivity[].edge_id',
      why: 'Composite key: "${from_id}::${to_id}" (double-colon canonical format; live V2 nested entries carry from_id/to_id — legacy fixture entries carry edge_from/edge_to and are accepted equivalently)',
    },
    {
      kind: 'reshape',
      from: 'robustness.fragile_edges[]',
      to: 'robustness.fragile_edges[]',
      why: 'REORDERED, most-fragile-first (switch_probability desc, missing sorts last, stable). ISL does not emit these in fragility order — live build 1dd45b6 returned [0.075, 0.281, 0.375, 0.487, 0.569, 0.61, 0.307], so [0] was the LEAST fragile. Multiple PLoT and CEE consumers read the head of this array without sorting it. See normalizeFragileEdges in src/integrations/isl/adapters/robustness-analysis.ts.',
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
    // ⚠ CORRECTED 25 Jul 2026 (lane PLoT importance-authority). This line used
    // to read "Constant: 'isl'". That has been FALSE since f6f7255 (22 Jan
    // 2026) made the graph path primary: every live row publishes
    // `source: 'graph'` (verified in the checked-in golden AND against
    // plot-lite-service-staging build 1dd45b6). A contract line that describes
    // the pre-change world is the hand-maintained-mirror defect this file
    // exists to prevent.
    'factor_sensitivity[].source',       // 'graph' on the primary path | 'isl' on the ISL-only fallback. A legacy/object provenance label — for the RANKING basis read importance_basis, not this.
    'factor_sensitivity[].importance_basis', // Lane PLoT importance-authority: 'graph_structural' | 'isl_uncertainty'. The runtime disclosure for every entry in `substitutions` below. ⚠ SUPERSEDED by driver_order.basis — kept for ONE release as a fail-loud mirror (a per-row copy of an ORDER-level fact is N things to drift), then deleted. The agreement is pinned by tests/driver-order-attestation.fixture.test.ts.
    // ⭐ Family-4 slice S1: THE canonical driver ordering + its attestation.
    // PLoT's role in the ratified authority model is order + attest — exactly
    // ONE ordering over the factor set, plus the disclosure that makes it
    // interpretable (basis, lever policy, row species, separability, rank
    // stability). `ranked_factor_ids` is PARALLEL to factor_sensitivity[]:
    // the array IS the order. Emitted whenever factor_sensitivity is emitted,
    // including empty (basis 'none') — so absence is unambiguous and a
    // consumer can fail closed on a value it can read rather than on a key it
    // has to guess about.
    //
    // ⭐ S1b: driver_label 'biggest', dominant_factor,
    // m1_coaching.key_drivers[0], decision_brief.top_drivers[0] and the
    // facts-path importance_rank are all PROJECTIONS of
    // ranked_factor_ids[0] — they are no longer independent argmaxes, so no
    // two of them can name different factors. The raw structural argmax is
    // still published as factor_sensitivity[].influence_rank.
    // See src/lib/driver-order.ts.
    'driver_order',
    'driver_order.basis',                // 'graph_structural' | 'isl_uncertainty' | 'none' — the ORDER-level successor to the per-row importance_basis
    'driver_order.ranked_factor_ids',    // the canonical order, IDS only (a second copy of a label is a second thing to drift)
    'driver_order.species',              // 'single' | 'mixed_graph_isl' — the ISL-only tail appended with no re-sort carries an incommensurable quantity; before this field no consumer could detect it
    'driver_order.lever_policy',         // 'du_union' on /v2/run — the ISL stamp OR the options-derived intervention union; 'stamp_only' is RESERVED for the surfaces that still use the under-covering predicate
    'driver_order.lever_ids',            // levers are MARKED, not hidden — whether a lever may be CROWNED is a permission question, not a producer one
    'driver_order.separability',         // the TIE VERDICT — 🟡 PROVISIONAL (2026-07-28), ALWAYS read `.method`. `basis_value_exact_tie` = PROVEN non-separation, no threshold. `relative_gap_0.10_provisional` = the provisional default: relative gap (first−second)/first vs 0.10, the repo's one ratified near-tie magnitude, applied RELATIVELY because the basis quantity is max-normalised. `null` = UNRESOLVED — fail closed; returned for <2 rows, absent/non-finite values, or a top pair straddling the lever partition or two row species.
    'driver_order.rank_stability',       // ISL's MEASUREMENTS aggregated (worst rank_flip_rate, worst attribution_stability band). No threshold applied. null = not measured, never 0.
    'factor_sensitivity[].confidence_source', // B (tier-B): 'plot_unified_from_isl_bootstrap' | 'plot_unified_from_graph' — honest provenance tag (audit A1-PRIMARY)
    'factor_sensitivity[].confidence_provenance', // B (tier-B): typed disclosure object {computation_source, formula_version, is_provisional, calibration_status, input_quality} — audit A1-PRIMARY
    'auto_noise_applied',                // B (tier-B): boolean echo of ISL's auto-noise flag — present on analysis_status ∈ {computed, partial}, null when ISL omits — audit B3
    'auto_noise_provenance',             // B (tier-B): analysis-level typed disclosure object {applied, effect, formula_version, multiplier, noise_distribution, filter_scope, is_provisional, calibration_status} — audit B3
    // ISL's objective_ranking is passed through verbatim. Its dense producer
    // ranks, joined to the same option shares and selected-goal direction, are
    // filtered through existing status/constraint policy once. Only a unique
    // surviving best rank licenses the existing recommendation fields.
    'recommended_option_id',
    'recommended_option_label',
    // CROWN ELIGIBILITY (step 5): the crown is derived over options ELIGIBLE to
    // be crowned — ISL-status candidates additionally permitted by the user's
    // stated limits — so `recommended_option_id` is ABSENT when none qualifies.
    // Absence was already a supported state (no finite win_probability), but it
    // now has a SECOND cause, and that cause has a name on the wire.
    'robustness.recommended_option_compliance',        // enum: not_applicable | compliant | uncertain | unverified | not_assessed | no_eligible_option
    'robustness.recommended_option_compliance_reason', // claim-safe producer phrase, no numbers — emit verbatim, never re-derive
    // ⛔ THE CONSUMER OBLIGATION, stated here because a UI reading this file is
    // the reader it exists for: on `no_eligible_option` there is NO
    // recommended_option_id, and the UI MUST render the reason ("no option met
    // the limits you set") rather than an empty leader slot. A blank badge is
    // indistinguishable from "we did not compute one", which is a different
    // and much weaker statement than the one the producer is making.
    // `uncertain` / `unverified` / `not_assessed` DO carry a crown — show it
    // WITH the reason; they are disclosures, not suppressions.
    // ⚠ `not_assessed` also covers "you stated a limit and PLoT could not carry
    // it to the engine" (a temporal deadline, a refused frame) — it does NOT
    // mean no limits were set. `not_applicable` is the only value that means
    // that.
    // ⚠ NEVER BINARISE `uncertain`: ISL publishes no satisfied/breached
    // threshold, so any cut the UI invents is a claim this producer declines to
    // make.
    'near_tie',                          // ⚠ WITHHELD on `no_eligible_option` — it carries `top_option_id`, a second leader-ish identifier, and rendering it there would restore exactly the badge the crown just refused. Present in every other state, unchanged.
    // Lane PLoT-W5 (roadmap Tier 1.6): display-safe robustness verdict — the
    // producer-owned meaning of is_robust/level so the UI never re-derives it.
    // Derived ONLY from is_robust + level (confidence is NEVER an input);
    // 'not_assessed' whenever robustness was not computed or the
    // verdict-bearing facts are missing. Emitted on success AND blocked/failed
    // error shapes. Mapping + wording provisional_doctrine_v0 — see
    // src/routes/v2/robustness-display-verdict.ts.
    'robustness.display_verdict',        // enum: robust | moderate | fragile | not_assessed
    'robustness.display_verdict_reason', // claim-safe producer phrase, no numbers (e.g. fragile → 'small changes could flip this result')
    'confidence_tier',                   // B1: derived from m1_coaching.readiness (ready→strong, close_call→fair, else→needs_work)
    'dominant_factor',                   // B1: detected from factor_sensitivity (influence >0.5 AND ratio >2:1)
    'factor_sensitivity[].evpi_percentage_points', // F3: VOI×win-prob-spread HEURISTIC only (the removed ISL factor_evpi[] counterfactual source is withdrawn; factor_evppi withheld pending S5). Source disclosed via evpi_method.
    'factor_sensitivity[].evpi_method',  // F3: currently only 'heuristic' (VOI×spread); 'counterfactual' reserved for the S5 typed surface
    'factor_sensitivity[].evpi_status',  // F3: RESERVED for the S5 counterfactual surface (was the below_resolution label); NOT emitted by the current build
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
    // Lane PLoT-W4 (ISL build 9a22a1a+): verbatim additive passthroughs —
    // present only when the ISL envelope carried them (and, for
    // path_decomposition, only when the /v2/run request opted in via
    // include_path_decomposition).
    'sensitivity_reference_option_id',   // Disclosure: option the sensitivity/fragile-edge analysis was computed against.
    'path_decomposition',                // Request-gated structural pathway decomposition (opt-in; not a causal claim).
    // ROADMAP 2.581 — verbatim additive passthrough, NOT an enrichment.
    // `option_comparison[].outcome.percentiles_source` is ISL's own
    // `Literal["samples","unavailable"]` provenance marker for p10/p50/p90.
    // ⚠ Until 2.581 this was an UNDECLARED DROP: the builder's explicit field
    // selection discarded it and no line in `drops` said so — the same "a
    // contract that lists 3 of 9 drops is worse than none" defect this file was
    // corrected for on 25 Jul. It is now carried, and the key is ABSENT (never
    // defaulted to 'samples') when ISL sends nothing or a value outside those
    // two literals.
    'option_comparison[].outcome.percentiles_source',
    // A3 lane 3 (ISL PR #71): seed-sweep flip-stability band — additive
    // passthrough on edge_e_values entries, NOT an enrichment.
    // DEFAULT-ON since ISL PR #76 — present when ISL computed a band for the
    // entry; key absent (never null) when ISL omits it (nothing to sweep, or
    // an older pre-#76 build). Lever edges: e-values (now incl. stability) are
    // currently PUBLISHED for levers — same surface as the open R2 doctrine
    // bullet on lever flip_thresholds/e-values; this lane invents no new
    // suppression pending that ruling.
    // ⚠ band_width == 0.0 BY CONSTRUCTION when n_seeds_flipped == 1.
    // UNITS INVARIANT (A3 lane 4, Paul's 17 Jul ruling): band values are
    // ALWAYS in the same space as the entry's flip_mean — when
    // current_mean/flip_mean are denormalised into goal units, band_min/
    // band_median/band_max and non-null seed_flip_means cells receive the
    // IDENTICAL map and band_width is RECOMPUTED from the mapped endpoints
    // (never offset-mapped); on the verbatim paths the band is verbatim too
    // (see ISLFlipStabilityBandV2).
    'edge_e_values[].stability',
  ],
} as const;
