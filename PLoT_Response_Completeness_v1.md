# PLoT V2RunResponse — Complete Field Inventory

> **Date:** 2026-03-23 | **Branch:** staging | **Response type:** `RunResponseV3` in `src/types/engine-v3.ts:739` | **Assembly:** `buildResponse()` in `src/routes/v2/run.ts:1111-1696`

Legend: **Always** = guaranteed present when parent object exists | **Conditional** = present under stated condition | **Never** = defined in type but not populated

---

## 1. Per-Option Result Fields (`OptionComparisonResultV3`)

Parent field: `option_comparison?: OptionComparisonResultV3[]` — present when `option_comparison_status === 'computed'`.

| Field | Type | Population | Source | Ref |
|-------|------|-----------|--------|-----|
| `option_id` | `string` | Always | ISL | run.ts:1486 |
| `option_label` | `string` | Always | ISL + graph options lookup | run.ts:1486 |
| `id` | `string` | Always | Alias of `option_id` (CIL 0.1 UI compat) | engine-v3.ts:1183 |
| `label` | `string` | Always | Alias of `option_label` | engine-v3.ts:1184 |
| `outcome` | `OutcomeStatsV3` | Conditional — when ISL computes | ISL Monte Carlo | engine-v3.ts:1198 |
| `outcome.mean` | `number` | Always (when outcome present) | ISL | engine-v3.ts:1159 |
| `outcome.std` | `number?` | Conditional — ISL may omit | ISL | engine-v3.ts:1161 |
| `outcome.p10` | `number` | Always (when outcome present) | ISL 10th percentile | engine-v3.ts:1163 |
| `outcome.p50` | `number` | Always (when outcome present) | ISL 50th percentile (median) | engine-v3.ts:1165 |
| `outcome.p90` | `number` | Always (when outcome present) | ISL 90th percentile | engine-v3.ts:1167 |
| `outcome.n_samples` | `number?` | Conditional | ISL metadata | engine-v3.ts:1169 |
| `outcome.n_valid_samples` | `number?` | Conditional | ISL metadata | engine-v3.ts:1171 |
| `outcome.validity_ratio` | `number?` | Conditional | ISL metadata | engine-v3.ts:1173 |
| `win_probability` | `number?` | Conditional — present when ISL returns it | ISL | engine-v3.ts:1211 |
| `probability_of_goal` | `number?` | Only when `goal_threshold` in request | ISL | engine-v3.ts:1207 |
| `probability_of_joint_goal` | `number?` | Only when `goal_constraints` in request | ISL constraint_analysis | engine-v3.ts:1217 |
| `constraint_probabilities` | `Record<string,number>?` | Only when `goal_constraints` in request | ISL constraint_analysis | engine-v3.ts:1224 |
| `status` | `'computed' \| 'skipped' \| 'error'` | Conditional | ISL | engine-v3.ts:1200 |
| `status_reason` | `string?` | When status !== 'computed' | ISL | engine-v3.ts:1202 |

**Deprecated V1 fields NOT in V2 output:**
- `expected_outcome` — use `outcome.mean`
- `confidence_interval` — use `[outcome.p10, outcome.p90]`
- `ci_lower` / `ci_upper` — never existed as named fields
- `median` — use `outcome.p50`

---

## 2. Edge Sensitivity (`EdgeSensitivityResultV3[]`)

Top-level field: `edge_sensitivity` — **always an array** (empty if unavailable). run.ts:1487.

| Field | Type | Population | Source |
|-------|------|-----------|--------|
| `edge_id` | `string` | Always | PLoT-computed (`from::to` double-colon) |
| `from` | `string` | Always | ISL `edge_from` |
| `to` | `string` | Always | ISL `edge_to` |
| `sensitivity_type` | `'existence' \| 'magnitude'` | Always | ISL |
| `elasticity` | `number` | Always | ISL |
| `importance_rank` | `number` | Always | ISL |
| `interpretation` | `string` | Always | ISL |

**Note:** Edge sensitivity entries have **no label enrichment** — only raw `from`/`to` node IDs.

---

## 3. Factor Sensitivity (`FactorSensitivityResultV3[]`)

Top-level field: `factor_sensitivity?` — **undefined when unavailable**. run.ts:1488.

Two sources with priority: (1) graph-based primary via `computeFactorSensitivityFromGraph()`, (2) ISL fallback via `transformFactorSensitivity()`.

| Field | Type | Population | Source |
|-------|------|-----------|--------|
| `factor_id` | `string` | Always | ISL `node_id` or graph factor |
| `factor_label` | `string?` | Always (enriched from graph) | Graph node label or ISL |
| `influence_score` | `number?` | Graph-based: always; ISL: may be absent | Graph or ISL |
| `influence_rank` | `number?` | When influence_score present | PLoT-computed |
| `sensitivity_score` | `number?` | Conditional | ISL `sensitivity_score` or legacy `sensitivity` |
| `elasticity` | `number?` | When ISL provides | ISL |
| `direction` | `'positive' \| 'negative' \| 'mixed' \| 'unknown'` | When ISL provides | ISL |
| `importance_rank` | `number?` | Same as influence_rank for graph-based | PLoT-computed |
| `interpretation` | `string?` | When ISL provides | ISL |
| `value_of_information` | `number?` | When ISL provides non-zero VoI | ISL |
| `confidence` | `number?` | Always computed when entry exists | PLoT unified formula: `0.5 * attribution_stability_band_score + 0.5 * mean(edge exists_probability)`. Defaults 0.5 when either absent |
| `zero_reason` | `string?` | When sensitivity_score = 0 | PLoT-computed |
| `source` | `'graph' \| 'isl'` | Always | PLoT tag |
| `confidence_source` | `'isl' \| 'graph'` | Always | PLoT tag |
| `flip_risk_category` | `'isolated' \| 'correlated' \| 'negligible'` | Conditional (needs fragile edge data) | PLoT-computed from fragile edge adjacency |
| `elasticity_std` | `number?` | Only when ISL 3C bootstrap | ISL 3C |
| `attribution_stability` | `'high' \| 'moderate' \| 'low' \| 'negligible'` | Only when ISL 3C | ISL 3C |
| `rank_flip_rate` | `number?` | Only when ISL 3C | ISL 3C |
| `stability_method` | `string?` | Only when ISL 3C | ISL 3C |
| `confidence_components.structural_certainty` | `number` | When confidence computed | PLoT: mean(incoming edge exists_probability) |
| `confidence_components.sampling_stability` | `number \| null` | When confidence computed | PLoT: attribution_stability_band_score or null |

---

## 4. Robustness (`RobustnessAssessmentV3`)

Top-level field: `robustness?` — present when `robustness_status === 'computed'`. run.ts:1540.

| Field | Type | Population | Source |
|-------|------|-----------|--------|
| `score` | `number?` | ISL V1 format | ISL |
| `label` | `'robust' \| 'moderate' \| 'fragile'` | ISL V1 format | ISL |
| `fragile_edges` | `NormalizedEdgeInfoV3[]` | **Always array** (CIL Phase 0 invariant — never null/undefined) | ISL + PLoT label enrichment |
| `robust_edges` | `NormalizedEdgeInfoV3[]` | **Always array** | ISL + PLoT label enrichment |
| `explanation` | `string?` | ISL V1 format | ISL |
| `recommendation_stability` | `number?` | ISL V2/Option C format (0-1) | ISL |
| `is_robust` | `boolean?` | ISL V2/Option C | ISL |
| `level` | `'high' \| 'medium' \| 'low' \| 'very_low'` | ISL V2/Option C | ISL |
| `confidence` | `number?` | ISL V2/Option C (0-1) | ISL |
| `recommended_option_id` | `string?` | Conditional — needs win_probability data | PLoT: argmax(win_probability) with lex tiebreak |
| `recommended_option_label` | `string?` | When recommended_option_id present | PLoT: graph node label -> option_comparison label -> option_id fallback |
| `near_tie` | `NearTieInfoV3?` | When gap between top 2 options < 0.10 | PLoT-computed |
| `normalization_errors` | `array?` | Only if edge normalization failed | PLoT |

**Fragile/Robust edge fields** (`NormalizedEdgeInfoV3`):

| Field | Type | Population |
|-------|------|-----------|
| `edge_id` | `string` | Always |
| `from_id` | `string` | Always |
| `to_id` | `string` | Always |
| `from_label` | `string` | Always (falls back to from_id) |
| `to_label` | `string` | Always (falls back to to_id) |
| `switch_probability` | `number` | Always (0-1) |
| `marginal_switch_probability` | `number?` | Conditional |
| `alternative_winner_id` | `string \| null` | Fragile: from ISL; Robust: null |
| `alternative_winner_label` | `string \| null` | Fragile: enriched from options; Robust: null |

**Near-tie fields** (`NearTieInfoV3`):

| Field | Type |
|-------|------|
| `is_tie` | `boolean` |
| `top_option_id` | `string` |
| `second_option_id` | `string \| null` |
| `tied_option_ids` | `string[]` |
| `gap` | `number` (0-1 probability) |
| `threshold` | `number` (default 0.10) |

---

## 5. Robustness Synthesis (`RobustnessSynthesisV3 | null`)

Top-level field: `robustness_synthesis`. run.ts:1541.

- **Populated:** When CEE available and called
- **Null:** When CEE unavailable/timed out/not called
- **Excluded from response_hash** (LLM-derived)

| Field | Type | Population |
|-------|------|-----------|
| `headline` | `string` | Always (when object present) |
| `assumption_explanations` | `Array<{edge_id, explanation, severity}>?` | Conditional |
| `investigation_suggestions` | `Array<{factor_id, suggestion, potential_value}>?` | Conditional |

---

## 6. Factor Stability (`FactorStabilityEntry[]`)

Top-level field: `factor_stability` — empty array when ISL provides no 3C bootstrap data. run.ts:1491.

| Field | Type | Population |
|-------|------|-----------|
| `factor_id` | `string` | Always (required) |
| `factor_label` | `string` | Always (required) |
| `elasticity_std` | `number` | Always (required) |
| `attribution_stability` | `'high' \| 'moderate' \| 'low' \| 'negligible'` | Always (required) |
| `rank_flip_rate` | `number` | Always (required) |
| `stability_method` | `string` | Always (required) |

---

## 7. Stability Thresholds (`StabilityThresholds`)

Top-level field: `stability_thresholds?` — only when ISL provides bootstrap analysis. run.ts:1495.

| Field | Type |
|-------|------|
| `high_moderate_boundary` | `number` |
| `moderate_low_boundary` | `number` |
| `version` | `string` |
| `provisional` | `boolean` |

---

## 8. Inference Warnings (`InferenceWarning[]`)

Top-level field: `inference_warnings` — **sentinel contract: ALWAYS `[]`, never absent**. run.ts:1499.

| Field | Type |
|-------|------|
| `code` | `InferenceWarningCode` |
| `message` | `string` |
| `severity` | `'info' \| 'warning'` |

Currently one warning code: `STABILITY_THRESHOLDS_MISSING` — emitted when ISL returns factor-level 3C fields but `stability_thresholds` is absent/malformed.

---

## 9. Critiques (`CritiqueV3[]`)

Top-level field: `critiques` — **always array, may be empty**. run.ts:1485.

### CritiqueV3 shape

| Field | Type | Population |
|-------|------|-----------|
| `id` | `string` | Always |
| `code` | `string` | Always |
| `severity` | `'BLOCKER' \| 'WARNING' \| 'INFO'` | Always |
| `message` | `string` | Always (internal/debug) |
| `user_message` | `string?` | Conditional (human-readable for UI) |
| `source` | `'preflight' \| 'normalisation' \| 'isl' \| 'engine' \| 'validation'` | Always |
| `affected_option_ids` | `string[]?` | Conditional |
| `affected_node_ids` | `string[]?` | Conditional |
| `blocks_analysis` | `boolean` | Always |
| `suggestion` | `string?` | Conditional |

### All possible critique codes

**Trust/Preflight** (`CRITIQUE_CODES` in critique-codes.ts):
`GRAPH_TOO_LARGE` | `GRAPH_CYCLE_DETECTED` | `GRAPH_DISCONNECTED` | `GRAPH_MISSING_EDGES` | `COLLIDER_RISK` | `INVALID_NODE_KIND` | `MISSING_BASELINE` | `IDENTIFIABILITY_ISSUE` | `MISSING_COMPETITOR_RESPONSE` | `PSYCHOLOGICAL_THRESHOLD` | `ISL_CANNOT_IDENTIFY` | `ISL_UNCERTAIN` | `ISL_ISSUE` | `ISL_FRAGILE` | `CEE_UNIFORM_WEIGHTS` | `CEE_WEIGHT_ISSUE` | `CEE_BELIEF_ISSUE` | `EVIDENCE_STALE` | `EVIDENCE_MISSING` | `EVIDENCE_LOW_COVERAGE`

**Inline** (`INLINE_CRITIQUE_CODES` in engine-v3.ts:550-568):
`NORMALIZATION_ERROR` | `NORMALIZATION_WARNING` | `IDENTIFIABILITY_WARNING` | `UNMEASURED_CONFOUNDING_WARNING` | `TOO_MANY_CONSTRAINTS` | `ISL_NOT_ENABLED` | `CONSTRAINT_OUT_OF_DOMAIN` | `CONSTRAINT_FILTERED_TEMPORAL` | `ISL_REQUEST_INVALID` | `ISL_CALL_FAILED` | `ISL_EMPTY_RESULTS` | `ISL_ERROR` | `SCALE_MISMATCH_WARNING` | `INVALID_BIDIRECTED_EDGE` | `IDENTICAL_OPTIONS_DEDUPED`

**Constraint warnings** (`CONSTRAINT_WARNING_CODES` in engine-v3.ts:536-541):
`CONSTRAINT_VALUE_OUTSIDE_RANGE` | `CONSTRAINT_MISSING_RANGE` | `CONSTRAINT_DUPLICATE_TARGET` | `CONSTRAINT_TARGET_NO_OBSERVED_VALUE`

**M1 Coaching types** (coaching/types.ts:105-112):
`DOMINANT_FACTOR` | `MISSING_RISK_PATHWAY` | `INFLUENTIAL_EXTERNALS` | `NARROW_FRAMING` | `ANCHORING_RISK` | `OVERCONFIDENCE` | `GOAL_FEASIBILITY_LOW` | `CONSTRAINT_UNGROUNDED`

---

## 10. Constraint Analysis Fields (Phase 1c)

All conditional — only present when `goal_constraints[]` provided in request. Spread via `buildConstraintFields()` at run.ts:1480.

| Field | Type | Condition |
|-------|------|-----------|
| `constraints_status` | `ConstraintFeatureStatus` | When `goal_constraints` in request |
| `constraint_results` | `ConstraintResult[]` | When constraints_status='computed' |
| `constraint_diagnostics` | `ConstraintDiagnostic[]` | When constraints computed |
| `conditional_probabilities` | `ConditionalProbability[]` | When ISL returns them |

---

## 11. M1 Coaching (`M1Coaching`)

Top-level field: `m1_coaching?` — undefined if ISL unavailable or generation fails. run.ts:1505. Deterministic (no LLM). Excluded from response_hash.

### Core fields
| Field | Type | Population |
|-------|------|-----------|
| `story_headlines` | `StoryHeadlines` | Always |
| `evidence_gaps` | `EvidenceGap[]` | Always |
| `model_critiques` | `Critique[]` | Always (may be empty) |
| `next_actions` | `NextAction[]` | Always |
| `readiness` | `'ready' \| 'close_call' \| 'needs_evidence' \| 'needs_framing'` | Always |
| `headline_type` | `'clear_winner' \| 'moderate_winner' \| 'close_call' \| 'high_uncertainty' \| 'needs_evidence'` | Always |
| `top_fragile_edge` | `{edge_id, label, alternative_winner, switch_probability}?` | When fragile edges exist |
| `coaching_version` | `string` | Always |
| `computed_at` | `string` | Always (ISO 8601) |

### Extended fields (Phases 3-4)
| Field | Type | Population |
|-------|------|-----------|
| `assumptions_ledger` | `{assumptions[], total_count, high/medium/low_impact_count}?` | Conditional |
| `thresholds_used` | `object?` | Conditional |
| `readiness_signals` | `{overall, overall_score, dimensions, signals[]}?` | Conditional |
| `key_drivers` | `Array<{factor_id, factor_label, influence_score, normalised_impact, impact_display, direction, rank}>?` | Conditional |
| `executive_summary` | `{summary, decision_statement, key_qualifier, action_implication}?` | Conditional |

---

## 12. M2 Decision Review

Spread from `m2DecisionReview` at run.ts:1525-1537. LLM-derived, excluded from response_hash.

| Field | Type | Population |
|-------|------|-----------|
| `m1_review` | `M1Review \| null` | When CEE available + review passes 9-tier validation |
| `review_status` | `'complete' \| 'failed' \| 'skipped' \| 'disabled'` | When M2 attempted |
| `review_meta` | `{model?, latency_ms?, tokens?}` | When status='complete' |
| `review_failure_codes` | `string[]` | When status='failed' |
| `review_warnings` | `string[]` | When status='complete' with non-critical issues |
| `review_skip_reason` | `ReviewSkipReason` | When status='skipped' |

---

## 13. CEE Results Panel

run.ts:1544-1551.

| Field | Type | Population |
|-------|------|-----------|
| `cee_status` | `'available' \| 'unavailable' \| 'degraded' \| 'skipped'` | When CEE orchestration runs |
| `decision_quality` | `DecisionQualityV3 \| null` | When CEE available |
| `insights` | `InsightV3[] \| null` | When CEE available |
| `improvement_guidance` | `ImprovementGuidanceV3[] \| null` | When CEE available |
| `rationale` | `RationaleV3 \| null` | When CEE available |
| `ceeTrace` | `{requestId, degraded, timestamp, source?, reason?, status?, latency_ms?, ...}` | Observability metadata |

---

## 14. Decision Brief (`DecisionBriefV1 | null`)

Top-level field: `decision_brief`. run.ts:1561. Excluded from response_hash.

- **Populated:** When `analysis_status === 'computed'`
- **Null:** When analysis blocked or failed

| Field | Type |
|-------|------|
| `brief_id` | `string` (UUID from SHA-256 of graph_hash:seed:config_version) |
| `version` | `'1'` |
| `graph_hash` | `string` |
| `seed` | `number` |
| `created_at` | `string` (ISO 8601) |
| `headline` | `string` |
| `options` | `BriefOption[]` (ranked by win_probability) |
| `top_drivers` | `BriefDriver[]` (top 5 by elasticity) |
| `key_assumptions` | `string[]` (max 10) |
| `what_would_change` | `string[]` (max 10) |
| `robustness` | `'robust' \| 'moderate' \| 'fragile'` |
| `warnings` | `BriefWarning[]` (max 10) |
| `lineage` | `BriefLineage` |

---

## 15. Flip Thresholds (`DenormalisedFlipThreshold[]`)

Top-level field: `flip_thresholds?` — when factor sensitivity data available. run.ts:1509. Max 5 factors (top by |elasticity|). Values in user units. Excluded from response_hash.

---

## 16. Threshold Analysis (B10.3)

Conditional — only when `include_thresholds=true` in request. run.ts:1513-1516.

| Field | Type | Population |
|-------|------|-----------|
| `thresholds_status` | `'not_requested' \| 'skipped_budget' \| 'timeout' \| 'error' \| 'computed'` | When include_thresholds set |
| `thresholds_meta` | `{reason?, duration_ms?}` | When status !== 'not_requested' |
| `threshold_analysis` | `ThresholdResult[]` | When status='computed' |

ThresholdResult fields: `factor_id`, `factor_label`, `threshold_value`, `current_value`, `crossing_direction`, `affected_options[]`, `margin`.

---

## 17. Identifiability Assessment

Top-level field: `identifiability` — **always present**. run.ts:1521. Uses `{status: 'unknown', ...}` fallback.

---

## 18. Feature-Gated Fields

| Field | Gate | Default |
|-------|------|---------|
| `review_cards` | `ENABLE_REVIEW_PASS` | Always `[]` when OFF |
| `fact_objects` | `ENABLE_FACTS_ASSEMBLY` | Always `[]` when OFF |
| `factor_enrichments` | CEE availability | Undefined when CEE unavailable |
| Extended `_meta` fields (builds, payloads) | `UI_CANONICAL_META` | Omitted when OFF |

---

## 19. `_meta` (Canonical Metadata)

Top-level field: `_meta` — **always present**. run.ts:1576-1656.

| Field | Type | Population |
|-------|------|-----------|
| `source_path` | `'isl' \| 'graph_fallback'` | Always |
| `repairs_applied` | `RepairRecord[]` | Always (F.5 canonical shape) |
| `request_id` | `string` | Always |
| `plot_build` | `string` | Always (default 'unknown') |
| `hash_version` | `string` | Always |
| `response_hash` | `string?` | Conditional (undefined on early-exit) |
| `builds` | `{ui, cee, plot, isl}` | When `UI_CANONICAL_META` ON |
| `payloads` | `{isl_request, isl_response}` | When `UI_CANONICAL_META` ON + ISL called |
| `request_id_chain` | Brief 4 spec (6 fields) | When chain available |
| `constraint_sources` | `Record<constraint_id, source>` | When `goal_constraints` present |
| `filtered_constraints` | `array` | When temporal constraints filtered |
| `range_derivation_sources` | `Record<factor_id, derivation_tier>` | When range derivation tracked |
| `feature_flags_snapshot` | `Record<string, string>` | Always |
| `decision_brief_assembled` | `boolean` | Always |
| `review_cards_count` | `number` | Always |
| `evidence_priority_card_present` | `boolean` | Always |

**RepairRecord fields:**
`field`, `action` (`clamped`/`defaulted`/`inferred`/`floored`/`derived`/`normalised`/`removed`), `from_value`, `to_value`, `reason` + F.5 canonical: `code?`, `layer?`, `field_path?`, `before?`, `after?`, `severity?`

---

## 20. `meta` (Processing Metadata)

Top-level field: `meta` — **always present**. run.ts:1672-1694.

| Field | Type | Population |
|-------|------|-----------|
| `seed_used` | `string` | Always |
| `seed_source` | `'client_generated' \| 'server_generated'` | Always |
| `n_samples` | `number` | Always |
| `detail_level` | `string` | Always |
| `latency_ms` | `number` | Always |
| `normalization_ms` | `number?` | Conditional |
| `validation_ms` | `number?` | Conditional |
| `isl_ms` | `number?` | Conditional |
| `cee_ms` | `number?` | Conditional |
| `build` | `string?` | Conditional |
| `computed_at` | `string?` | Conditional (ISO 8601) |
| `request_id_chain` | `{ui, plot, isl, isl_echoed, all_match, chain_complete}` | Conditional |
| `feature_flags` | `Record<string, string \| boolean>` | Always (includes `facts_assembly`, `review_pass`) |

---

## 21. Other Top-Level Fields

| Field | Type | Population | Ref |
|-------|------|-----------|-----|
| `request_schema_version` | `'v3'` | Always | run.ts:1467 |
| `endpoint_version` | `'v2/run'` | Always | run.ts:1468 |
| `preflight_version` | `string` | Always (`'2025-12-26'`) | run.ts:1469 |
| `request_id` | `string?` | Always | run.ts:1470 |
| `analysis_status` | `'computed' \| 'partial' \| 'failed' \| 'blocked'` | Always | run.ts:1472 |
| `status_reason` | `string?` | When analysis_status !== 'computed' | run.ts:1473 |
| `option_comparison_status` | `'computed' \| 'unavailable' \| 'skipped' \| 'error'` | Always | run.ts:1475 |
| `robustness_status` | PerFeatureStatus | Always | run.ts:1476 |
| `drivers_status` | PerFeatureStatus | Always | run.ts:1477 |
| `isl_analysis_status` | `string?` | Conditional (ISL debug) | run.ts:1482 |
| `isl_status_reason` | `string?` | Conditional (ISL debug) | run.ts:1483 |
| `processing_time_ms` | `number?` | Conditional (alias for meta.latency_ms) | run.ts:1554 |
| `response_hash` | `string?` | Conditional (undefined on early-exit) | run.ts:1556 |
| `downstream_calls` | `{isl?, cee?}` | Conditional (undefined if no calls) | run.ts:1659-1668 |

---

## 22. New Fields from Current Tracks

| Field | Status | Notes |
|-------|--------|-------|
| `edge_e_values[]` | **IMPLEMENTED** | Optional, present when ISL returns E-value analysis. Enriched with `from_label`/`to_label`. Excluded from response_hash. |
| `conditional_winners[]` | **IMPLEMENTED** | Optional, present when ISL returns conditional winner analysis. Enriched with factor and option labels. Excluded from response_hash. |
| `inference_warnings[]` | **EXISTS + ISL MERGE** | Always present as `[]` sentinel. Now merges ISL-originated warnings (e.g., `MISSING_ROOT_VALUE`) alongside PLoT-originated ones. |
| `evpi` / `evpi_percentage_points` on VoI entries | **NOT ON VoI ENTRIES** | Separate `/v1/evoi` endpoint returns `evoi_impact` + `evoi_rank` per edge, but not integrated into `/v2/run` response |
| `range_derivation_source` per factor | **ON factor_sensitivity + `_meta`** | Now surfaced as `range_derivation_source` on each `FactorSensitivityResultV3` entry AND in `_meta.range_derivation_sources`. |

---

## 23. Label Enrichment Summary

| Target | Labels Added | Source |
|--------|-------------|--------|
| Fragile edges | `from_label`, `to_label`, `alternative_winner_label` | Graph node labels + option labels |
| Robust edges | `from_label`, `to_label` (alternative_winner = null) | Graph node labels |
| Factor sensitivity entries | `factor_label` | Graph node labels or ISL |
| Option comparison entries | `option_label`, `label` (alias) | Request options + graph |
| Threshold analysis entries | `factor_label` | Graph node labels |
| Edge sensitivity entries | `from_label`, `to_label` | Graph node labels (same fallback as fragile edges) |
| Edge E-value entries | `from_label`, `to_label` | Graph node labels |
| Conditional winner entries | `factor_label`, `winner_label`, `runner_up_label` | Graph node labels + option labels |

---

## 24. Response Hash Scope

`response_hash` covers semantic request fields only. **Excluded from hash:**

- ISL bootstrap internals (`factor_stability`, `stability_thresholds`)
- LLM-derived fields (`factor_enrichments`, `robustness_synthesis`, `m1_review`)
- Coaching (`m1_coaching`)
- Post-analysis enrichments (`flip_thresholds`, `threshold_analysis`)
- Diagnostic metadata (`inference_warnings`, `identifiability` since v6)
- Feature-gated payloads (`review_cards`, `fact_objects`)
- All `_meta` fields, `decision_brief`, `downstream_calls`

---

## Source Files

| File | Contents |
|------|----------|
| `src/types/engine-v3.ts:739-1151` | RunResponseV3 type definition |
| `src/routes/v2/run.ts:1111-1696` | `buildResponse()` assembly |
| `src/trust/critique-codes.ts` | CRITIQUE_CODES enum (20 codes) |
| `src/types/engine-v3.ts:536-568` | CONSTRAINT_WARNING_CODES + INLINE_CRITIQUE_CODES |
| `src/coaching/types.ts:105-112` | M1 coaching critique types (8 codes) |
| `src/coaching/critiques.ts` | M1 critique generation logic |
| `openapi/openapi-plot-lite-v1.yaml` | Hand-authored OpenAPI spec |
