# PLoT Graph Operations Inventory

**Audit Date**: 2026-01-21
**SSOT Version**: v1.2
**Auditor**: Claude Code

---

## Executive Summary

This document inventories all graph operations performed by PLoT, classifying each as either:
- **Semantic Transform**: Changes that affect analysis results (CEE must NOT duplicate)
- **Presentation Transform**: Formatting/UI-only changes (safe for CEE to transform independently)

### Key Findings

| Category | Count | Location |
|----------|-------|----------|
| Normalisation Operations | 12 | `src/normalisation/` |
| Node Filtering Operations | 3 | `src/normalisation/option-filter.ts` |
| Edge Clamping Operations | 5 | `src/normalisation/graph-normaliser.ts` |
| Response Transforms | 8 | `src/routes/v2/run.ts` |
| Factor Influence Computation | 2 | `src/lib/factor-influence.ts` |

---

## 1. Normalisation Operations

### 1.1 Node Normalisation
**File**: [src/normalisation/graph-normaliser.ts](../../src/normalisation/graph-normaliser.ts)
**Function**: `normaliseNode()` (lines 95-187)

| Field | Transform | Type | Source Line |
|-------|-----------|------|-------------|
| `kind` | Resolve from `kind ?? type ?? data.kind ?? data.type ?? 'factor'` | Semantic | 104-109 |
| `label` | Fallback to `node.id` if missing | Presentation | 181 |
| `description` | Map from legacy `body` field | Presentation | 182 |
| `intercept` | Validate finite number, reject null | Semantic | 136-159 |
| `observed_state` | Extract from nested `data.value` | Semantic | 161-173 |
| `state_space` | Extract from `state_space ?? data.state_space` | Semantic | 176 |

**Warning Codes**:
- `UNKNOWN_NODE_KIND` (line 116): Node has unrecognized kind

### 1.2 Edge Normalisation
**File**: [src/normalisation/graph-normaliser.ts](../../src/normalisation/graph-normaliser.ts)
**Function**: `normaliseEdge()` (lines 233-402)

| Field | Transform | Type | Source Line | Repair Code |
|-------|-----------|------|-------------|-------------|
| `from/to` | Resolve from `from ?? source`, `to ?? target` | Semantic | 240-241 | - |
| `exists_probability` | Default to 0.8, clamp [0,1] | Semantic | 271-291 | `COEFFICIENT_REPAIRED` |
| `strength.mean` | Derive from weight+direction, clamp [-1,1] | Semantic | 296-351 | `COEFFICIENT_REPAIRED` |
| `strength.std` | Derive from belief, clamp [0.05,0.4], floor to 0.001 | Semantic | 353-393 | `COEFFICIENT_REPAIRED` |
| `effect_direction` | Infer from node kinds (risk→goal = negative) | Semantic | 327-342 | `DIRECTION_INFERRED` |
| `label` | Pass through | Presentation | 400 | - |

### 1.3 Repair Actions

Each repair generates a warning with code `COEFFICIENT_REPAIRED`:

| Repair | Condition | Action | Line |
|--------|-----------|--------|------|
| `exists_probability` defaulted | Missing or non-finite | Set to 0.8 | 274-282 |
| `exists_probability` clamped | Outside [0,1] | Clamp to range | 284-290 |
| `strength.mean` defaulted | Missing `strength.mean` and `weight` | Use 0.5 | 316-324 |
| `strength.mean` clamped | Outside [-1,1] | Clamp to range | 347-350 |
| `strength.std` defaulted | Missing | Derive from mean+belief | 371-373 |
| `strength.std` clamped | Outside [0.05,0.4] | Clamp to range | 381-385 |
| `strength.std` floored | Non-finite or ≤0 | Set to 0.001 | 376-391 |

---

## 2. Node Filtering Operations

### 2.1 Non-Causal Node Filtering
**File**: [src/normalisation/option-filter.ts](../../src/normalisation/option-filter.ts)
**Function**: `filterOptionNodes()` (lines 67-109)

| Operation | Input | Output | Type |
|-----------|-------|--------|------|
| Remove non-causal nodes | Nodes with kind in `['option', 'decision', 'constraint']` | Filtered node array | Semantic |
| Remove incident edges | Edges where `from` or `to` is non-causal | Filtered edge array | Semantic |

**Exported Functions**:
- `filterOptionNodes(graph)` → `{ filteredGraph, removedNodeIds, removedEdgeCount }`
- `hasOptionNodes(graph)` → boolean
- `countOptionNodes(graph)` → number
- `filterForISL(graph)` → filtered graph

**Non-Causal Kinds** (from `NON_CAUSAL_NODE_KINDS`):
- `option`
- `decision`
- `constraint`

---

## 3. Factor Influence Computation

### 3.1 Path-Based Influence
**File**: [src/lib/factor-influence.ts](../../src/lib/factor-influence.ts)
**Function**: `computeFactorInfluence()` (lines 247-301)

| Operation | Description | Type |
|-----------|-------------|------|
| Build edge lookup | Map source → outgoing edges | Internal |
| DFS path finding | Find all paths from factor to goal | Semantic |
| Influence computation | Sum of path effects (product of strength.mean) | Semantic |
| Confidence computation | Geometric mean of edge confidences | Semantic |
| Normalisation | Divide by max absolute influence | Presentation |
| Sorting | Sort by absolute influence descending | Presentation |

**Output Fields**:
```typescript
interface FactorInfluence {
  factor_id: string;       // Node ID
  label: string;           // Node label
  influence: number;       // Raw causal effect (sum of path products)
  normalised_influence: number;  // 0-1 relative to max
  confidence: number;      // 0-1 combined certainty
  direction: 'positive' | 'negative';
}
```

**Configuration**:
- `MAX_PATH_DEPTH = 10` (line 57)
- `MIN_EXISTS_PROBABILITY = 0.01` (line 60)

---

## 4. Response Transforms

### 4.1 Seed Resolution
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `resolveSeed()` (lines 264-279)

| Condition | Transform | Type |
|-----------|-----------|------|
| Seed provided | Use as-is (convert to string) | Semantic |
| Seed omitted | Derive from graph topology hash | Semantic |

**Hash Scope** (intentionally limited):
- Node: `id`, `kind`, `observed_state.value`
- Edge: `from`, `to`, `strength.mean`
- Excluded: `exists_probability`, `strength.std`

### 4.2 Option Comparison Transform
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `buildResponse()` (lines 516-571)

| Field | Source | Transform | Type |
|-------|--------|-----------|------|
| `option_id` | ISL `option_id ?? id` | Resolve alias | Presentation |
| `option_label` | Options array lookup | Add label | Presentation |
| `expected_outcome` | ISL `outcome.mean ?? outcome.p50 ?? expected_outcome` | Resolve nested | Semantic |
| `confidence_interval` | ISL `[outcome.p10, outcome.p90]` | Extract | Semantic |
| `outcome` | ISL outcome object | Pass through | Semantic |
| `probability_of_goal` | ISL | Omit if undefined | Semantic |
| `win_probability` | ISL | Omit if undefined | Semantic |

### 4.3 Edge Sensitivity Transform
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `transformEdgeSensitivity()` (lines 87-98)

| Field | Source | Transform | Type |
|-------|--------|-----------|------|
| `edge_id` | ISL `edge_from`, `edge_to` | Format as `from::to` | Presentation |
| `from` | ISL `edge_from` | Rename | Presentation |
| `to` | ISL `edge_to` | Rename | Presentation |
| `sensitivity_type` | ISL | Pass through | Semantic |
| `elasticity` | ISL | Pass through | Semantic |
| `importance_rank` | ISL | Pass through | Semantic |
| `interpretation` | ISL | Pass through | Semantic |

### 4.4 Factor Sensitivity Transform
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `transformFactorSensitivity()` (lines 104-112)

| Field | Source | Transform | Type |
|-------|--------|-----------|------|
| `factor_id` | ISL `node_id` | Rename | Presentation |
| `sensitivity_score` | ISL `sensitivity` | Rename | Semantic |
| `value_of_information` | ISL | Pass through | Semantic |
| `direction` | ISL | Pass through | Semantic |

### 4.5 Robustness Edge Normalisation
**File**: [src/integrations/isl/adapters/robustness-analysis.ts](../../src/integrations/isl/adapters/robustness-analysis.ts)

| Function | Input | Output | Type |
|----------|-------|--------|------|
| `normalizeFragileEdges()` | ISL fragile edge objects | Normalised edge info | Presentation |
| `normalizeRobustEdges()` | ISL robust edge strings/objects | Normalised edge info | Presentation |

### 4.6 Status Mapping
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `mapToPerFeatureStatus()` (lines 383-397)

| ISL Status | Data Present | Output | Type |
|------------|--------------|--------|------|
| any | true | `'computed'` | Presentation |
| `'failed'` | false | `'error'` | Presentation |
| `'skipped'` | false | `'skipped'` | Presentation |
| other | false | `'unavailable'` | Presentation |

---

## 5. CEE Integration (No Overlap)

### 5.1 CEE Request Building
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Function**: `buildCeeReviewRequest()` (lines 726-796)

CEE receives **already-transformed** data:
- `graph_snapshot` from filtered/normalised graph
- `inference_results` from ISL response
- `isl_robustness` summary

**No semantic transforms in CEE path** - all transforms occur before CEE call.

### 5.2 CEE Response Extraction
**File**: [src/routes/v2/run.ts](../../src/routes/v2/run.ts)
**Functions**: `extractCeeResultsFromResponse()`, `extractRobustnessSynthesis()`

CEE response fields are **passed through** without transformation:
- `decision_quality`
- `insights`
- `improvement_guidance`
- `rationale`
- `robustness_synthesis` (from CEE blocks)

---

## 6. Transform Classification Matrix

| Operation | Location | Classification | CEE Overlap Risk |
|-----------|----------|----------------|------------------|
| Node kind resolution | graph-normaliser.ts:104 | Semantic | None |
| Edge strength clamping | graph-normaliser.ts:347 | Semantic | None |
| Edge std derivation | graph-normaliser.ts:66 | Semantic | None |
| Non-causal node filtering | option-filter.ts:67 | Semantic | None |
| Factor influence computation | factor-influence.ts:247 | Semantic | None |
| Seed derivation | run.ts:264 | Semantic | None |
| Response hash computation | run.ts:1244 | Semantic | None |
| Edge ID formatting | run.ts:90 | Presentation | Safe |
| Field renaming | run.ts:107 | Presentation | Safe |
| Label resolution | run.ts:549 | Presentation | Safe |
| Status mapping | run.ts:383 | Presentation | Safe |

---

## 7. Repair Logging Points (Ledger Candidates)

All repairs emit warnings that should be captured in `_meta.repairs_applied`:

| Warning Code | Location | Repair Action |
|--------------|----------|---------------|
| `COEFFICIENT_REPAIRED` | graph-normaliser.ts:262 | Edge coefficient clamped/defaulted/floored |
| `DIRECTION_INFERRED` | graph-normaliser.ts:336 | Effect direction inferred from node kinds |
| `UNKNOWN_NODE_KIND` | graph-normaliser.ts:116 | Node kind not in valid set |
| `NORMALIZATION_WARNING` | graph-normaliser.ts:467 | Option node will be filtered |

---

## 8. Invariant Contracts

### 8.1 Input Invariants
1. Node `id` must be present and non-empty
2. Edge `from` and `to` must be present
3. Node `intercept` must be finite number or undefined (not null)

### 8.2 Output Invariants
1. `exists_probability` ∈ [0, 1]
2. `strength.mean` ∈ [-1, 1]
3. `strength.std` ∈ [0.001, 0.4]
4. `normalised_influence` ∈ [0, 1]
5. `confidence` ∈ [0, 1]
6. `direction` ∈ {'positive', 'negative'}
7. No non-causal nodes in filtered graph
8. No edges incident to non-causal nodes in filtered graph

### 8.3 Idempotency Invariants
1. `normaliseGraph(normaliseGraph(g).graph)` = `normaliseGraph(g)` (coefficients already clamped)
2. `filterOptionNodes(filterOptionNodes(g).filteredGraph)` = `filterOptionNodes(g)` (no non-causal nodes remain)

---

## Appendix A: File Reference

| File | Purpose |
|------|---------|
| `src/normalisation/graph-normaliser.ts` | Node/edge normalisation, coefficient clamping |
| `src/normalisation/option-filter.ts` | Non-causal node filtering |
| `src/normalisation/canonicalise.ts` | Request hashing |
| `src/lib/factor-influence.ts` | Path-based influence computation |
| `src/routes/v2/run.ts` | Response building, status mapping |
| `src/integrations/isl/adapters/robustness-analysis.ts` | ISL robustness normalisation |
| `src/integrations/isl/adapters/robustness-enrichment.ts` | CEE robustness data building |

## Appendix B: Constants Reference

| Constant | Value | File | Line |
|----------|-------|------|------|
| `DEFAULT_EXISTS_PROBABILITY` | 0.8 | graph-normaliser.ts | 50 |
| `DEFAULT_WEIGHT` | 0.5 | graph-normaliser.ts | 51 |
| `MIN_STD` | 0.001 | graph-normaliser.ts | 52 |
| `STD_RANGE_MIN` | 0.05 | graph-normaliser.ts | 53 |
| `STD_RANGE_MAX` | 0.4 | graph-normaliser.ts | 54 |
| `MAX_PATH_DEPTH` | 10 | factor-influence.ts | 57 |
| `MIN_EXISTS_PROBABILITY` | 0.01 | factor-influence.ts | 60 |
