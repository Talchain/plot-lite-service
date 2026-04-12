# PLoT Response Schema Audit — B0

> **Purpose:** Determine which of the 5 analytical classifications currently computed locally in the UI already exist in the PLoT response, before any new fields are added or changed.
>
> **Scope:** Read-only. No code changes. Source of truth is the `/v2/run` endpoint, which is what the main canvas UI consumes.
>
> **Date:** 2026-04-12

---

## Audit Table

| # | Classification | Exists in PLoT? | Available on `/v2/run`? | Field path | Defined in (schema) | Built in (response) | PLoT enum / type | Current UI logic (`useResultsSectionData.ts`) | UI output values | Matches UI logic? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Robustness level** | Yes | Yes | `robustness.level` (ISL passthrough, optional) `robustness.label` (canonical, always present) | `src/types/engine-v3.ts:1560–1593` (`RobustnessAssessmentV3`) | `src/routes/v2/run.ts:1546–1631` | `level`: `'high' \| 'medium' \| 'low' \| 'very_low'` (lowercase) `label`: `'robust' \| 'moderate' \| 'fragile'` (lowercase) | Reads `robustness.level`; normalises `'medium'` → `'moderate'`; falls back to `recommendation_stability` numeric derivation if absent | `'high' \| 'moderate' \| 'low' \| 'very_low'` | **Near-match with one mismatch:** PLoT sends `'medium'`; UI expects `'moderate'`. UI already handles this in-place. The canonical `label` (`robust/moderate/fragile`) is a different vocabulary and not used for the level classification. |
| 2 | **Fragile edge severity** | No | No | — | `src/types/engine-v3.ts:1512–1527` (`NormalizedEdgeInfoV3`) has `switch_probability` only | `src/routes/v2/run.ts:1549–1596` (`normalizeFragileEdges()`) | Only `switch_probability: number` (0–1) on each fragile edge entry | Reads `fe.switch_probability`; maps: `> 0.7` → `'critical'`, `> 0.5` → `'error'`, `<= 0.5` → `'warning'`. Filters edges below `FRAGILE_EDGE_THRESHOLD = 0.3` | `'critical' \| 'error' \| 'warning'` | **No match.** No `severity` field on `fragile_edges[]`. If PLoT adds it, would go in `normalizeFragileEdges()` in `src/integrations/isl/adapters/robustness-analysis.ts:96–143`. Note: CEE `robustness_synthesis.assumption_explanations[].severity` exists but uses different vocabulary (`'fragile' \| 'moderate' \| 'robust'`) and is on a different object. |
| 3 | **Confidence tier** | Partial (V1 only) | **No** | `confidence.level` — **only on `/v1/run`** | `src/trust/confidence.ts:101–111` (`ConfidenceBadge`) | `src/routes/v1/run.ts:786–792` — not called anywhere in V2 handler | `'HIGH' \| 'MEDIUM' \| 'LOW'` **(uppercase)** | Reads `graphReadiness.readiness_level` (primary); falls back to `readiness_score`, then `report.confidence.level`, then `report.graph_quality.score`. Maps: `'ready'` → `'strong'`, `'caution'`/`'fair'` → `'fair'`, `'not_ready'`/`'needs_work'` → `'needs_work'`. Numeric thresholds: `>= 70` → `'strong'`, `>= 40` → `'fair'`, `< 40` → `'needs_work'` | `'strong' \| 'fair' \| 'needs_work' \| 'unknown'` | **No match on V2 path.** Two mismatches if V1 field were reused: (1) case — V1 sends uppercase `'HIGH'`; UI maps lowercase `'high'` to `'strong'`; (2) vocabulary — V1 tier vocabulary (`HIGH/MEDIUM/LOW`) differs from UI output vocabulary (`strong/fair/needs_work`). UI `mapConfidenceLevel()` handles both if called, but V2 does not emit this field at all. |
| 4 | **Dominance detection** | No | No | — (`ranking_summary.winner_dominant` exists on `/v1/run_bundle` only; `robustness.dominant_factor` does not exist in any PLoT response) | `src/routes/v1/types/run-bundle.types.ts:151–168` (`RankingSummary`) — not in V2 types | `src/routes/v1/run-bundle.ts:595` calling `isWinnerDominant()` in `src/trust/ranking-confidence.ts:129–147` | `boolean` | Checks `robustness.dominant_factor` (field absent from V2 response); falls back to local heuristic: top-driver `influence_score > 0.5` **AND** ratio vs. second driver `> 2:1` | `{ dominantFactorId: string \| undefined, dominantFactorLabel: string \| undefined }` | **No match.** Different endpoint, different logic (stochastic p10/p50/p90 dominance vs. influence-score ratio heuristic), different output shape. Treat as a new field for B1. |
| 5 | **Driver impact labels** | No | Partial (numeric only) | `factor_sensitivity[].influence_score` (0–1) and `influence_rank` present; no categorical label | `src/types/engine-v3.ts:1363–1402` (`FactorSensitivityResultV3`) | `src/routes/v2/run.ts:1537, 1715, 1766` (`transformFactorSensitivity()`) | `influence_score?: number` (0–1), `influence_rank?: number`, `direction?: 'positive' \| 'negative' \| 'mixed' \| 'unknown'` — no `impact_label` | Reads `normalisedValue` (derived from `influence_score`); rank 1 → `'biggest'`; else: `>= 0.50` → `'strong'`, `>= 0.20` → `'moderate'`, `< 0.20` → `'minor'` | `'biggest' \| 'strong' \| 'moderate' \| 'minor'` | **No match.** The numeric inputs (`influence_score`, `influence_rank`) exist on V2, but no categorical label field. UI uses a rank-relative + threshold-based classification that requires both rank position and normalised score. |

---

## Enum Case Reference

| Field | PLoT sends | UI expects / produces | Action needed |
|---|---|---|---|
| `robustness.level` | `'high' \| 'medium' \| 'low' \| 'very_low'` (lowercase) | `'high' \| 'moderate' \| 'low' \| 'very_low'` | Map `'medium'` → `'moderate'` (UI already does this) |
| `robustness.label` | `'robust' \| 'moderate' \| 'fragile'` (lowercase) | Not directly consumed for level output | No action; different vocabulary |
| `confidence.level` (V1 only) | `'HIGH' \| 'MEDIUM' \| 'LOW'` **(uppercase)** | `'strong' \| 'fair' \| 'needs_work'` | Not on V2 path; would need both lowercasing and vocabulary remapping (`mapConfidenceLevel()` handles this if field reaches UI) |

---

## B1 Implications

### Fields the UI can read immediately (with minor mapping)

| Field | Action |
|---|---|
| **Robustness level** (`robustness.level`) | Read as-is; the `'medium'` → `'moderate'` normalisation is already implemented in the UI. No backend change needed. |

### Fields PLoT must add to `/v2/run`

| Field | Where to add | Notes |
|---|---|---|
| **Fragile edge severity** | Add `severity: 'critical' \| 'error' \| 'warning'` to each `fragile_edges[]` entry in `normalizeFragileEdges()` (`src/integrations/isl/adapters/robustness-analysis.ts:96–143`). Thresholds from UI: `> 0.7` → critical, `> 0.5` → error, else warning. Update `NormalizedEdgeInfoV3` type in `src/types/engine-v3.ts:1512–1527`. | CEE `robustness_synthesis.assumption_explanations[].severity` uses different vocabulary; do not reuse. |
| **Confidence tier** | Add a confidence tier field to the V2 response, either by calling `calculateConfidence()` in the V2 handler or by emitting a new field (e.g. `confidence_tier: 'strong' \| 'fair' \| 'needs_work'`) computed from existing data. Must match UI output vocabulary (not V1's uppercase `HIGH/MEDIUM/LOW`). | Verify whether `graphReadiness.readiness_level` is already on the V2 response path before adding a new field — the UI's primary source may already be present. |
| **Dominance detection** | New boolean or object on the V2 `robustness` or summary object. Define shared logic: the V1 stochastic dominance definition (`isWinnerDominant()` in `src/trust/ranking-confidence.ts:129–147`) and the UI's ratio heuristic (`influence > 0.5 AND ratio > 2:1`) are not equivalent. Agree on canonical definition before implementing. | The `winner_dominant` boolean on `/v1/run_bundle` is not reusable as-is. |

### Fields where UI logic should be ported unchanged (no backend change needed)

| Field | Rationale |
|---|---|
| **Driver impact labels** | The raw inputs (`influence_score`, `influence_rank`) are already on the V2 response. The rank-relative + threshold classification (`'biggest' \| 'strong' \| 'moderate' \| 'minor'`) is pure presentation logic. No backend field is needed; port the `getSemanticLabel()` function from the UI if moving logic server-side is desired, but it is not required. |
