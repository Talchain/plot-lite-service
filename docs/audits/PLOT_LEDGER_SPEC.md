# PLoT Ledger Specification

**Version**: 1.0
**Date**: 2026-01-21
**SSOT Version**: v1.2

---

## Overview

This document specifies the ledger points where PLoT operations should be recorded for auditability, debugging, and the planned `_meta.repairs_applied` feature.

---

## 1. Ledger Point Categories

### 1.1 Repair Ledger Points
Operations that modify input data to satisfy constraints.

### 1.2 Transform Ledger Points
Operations that compute derived values from inputs.

### 1.3 Filter Ledger Points
Operations that remove elements from data structures.

---

## 2. Repair Ledger Points

### LP-REPAIR-001: Edge Coefficient Clamping
**Location**: `src/normalisation/graph-normaliser.ts:262-393`
**Trigger**: Edge coefficient outside valid range

| Field | Valid Range | Default | Repair Action |
|-------|-------------|---------|---------------|
| `exists_probability` | [0, 1] | 0.8 | Clamp or default |
| `strength.mean` | [-1, 1] | 0.5 | Clamp or derive from weight |
| `strength.std` | [0.001, 0.4] | Derived | Clamp or floor |

**Ledger Entry Schema**:
```typescript
interface RepairEntry {
  type: 'coefficient_repair';
  edge_id: string;
  field: 'exists_probability' | 'strength.mean' | 'strength.std';
  action: 'clamped' | 'defaulted' | 'floored' | 'derived';
  from_value: number | undefined;
  to_value: number;
  reason: string;
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "coefficient_repair",
  "edge_id": "factor_a::goal_1",
  "field": "exists_probability",
  "action": "clamped",
  "from_value": 1.5,
  "to_value": 1.0,
  "reason": "Value exceeded maximum bound [0, 1]",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

### LP-REPAIR-002: Effect Direction Inference
**Location**: `src/normalisation/graph-normaliser.ts:203-216, 327-342`
**Trigger**: Edge has no explicit `effect_direction` and source is 'risk' node

**Ledger Entry Schema**:
```typescript
interface DirectionInferenceEntry {
  type: 'direction_inference';
  edge_id: string;
  from_kind: string;
  to_kind: string;
  inferred_direction: 'positive' | 'negative';
  reason: string;
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "direction_inference",
  "edge_id": "risk_node::goal_node",
  "from_kind": "risk",
  "to_kind": "goal",
  "inferred_direction": "negative",
  "reason": "Risk nodes have negative effect on goals by default",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

### LP-REPAIR-003: Strength Derivation
**Location**: `src/normalisation/graph-normaliser.ts:66-70, 312-325, 358-374`
**Trigger**: `strength.mean` or `strength.std` missing, derived from `weight`/`belief`

**Ledger Entry Schema**:
```typescript
interface StrengthDerivationEntry {
  type: 'strength_derivation';
  edge_id: string;
  field: 'strength.mean' | 'strength.std';
  source_field: 'weight' | 'belief' | 'belief_strength' | 'exists_probability';
  source_value: number;
  derived_value: number;
  formula: string;
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "strength_derivation",
  "edge_id": "factor_a::outcome_1",
  "field": "strength.std",
  "source_field": "belief",
  "source_value": 0.8,
  "derived_value": 0.12,
  "formula": "deriveStd(mean, belief) = max(0.05, (0.3 * (1 - belief) + 0.1) * |mean|)",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

---

## 3. Filter Ledger Points

### LP-FILTER-001: Non-Causal Node Removal
**Location**: `src/normalisation/option-filter.ts:67-109`
**Trigger**: Node has kind in `['option', 'decision', 'constraint']`

**Ledger Entry Schema**:
```typescript
interface NodeFilterEntry {
  type: 'node_filter';
  node_id: string;
  node_kind: string;
  reason: 'non_causal_kind';
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "node_filter",
  "node_id": "option_1",
  "node_kind": "option",
  "reason": "non_causal_kind",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

### LP-FILTER-002: Incident Edge Removal
**Location**: `src/normalisation/option-filter.ts:91-97`
**Trigger**: Edge connects to a filtered non-causal node

**Ledger Entry Schema**:
```typescript
interface EdgeFilterEntry {
  type: 'edge_filter';
  edge_from: string;
  edge_to: string;
  reason: 'incident_to_filtered_node';
  filtered_node_id: string;
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "edge_filter",
  "edge_from": "option_1",
  "edge_to": "goal_1",
  "reason": "incident_to_filtered_node",
  "filtered_node_id": "option_1",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

### LP-FILTER-003: Low Probability Edge Exclusion
**Location**: `src/lib/factor-influence.ts:78-82`
**Trigger**: Edge has `exists_probability < 0.01`

**Ledger Entry Schema**:
```typescript
interface LowProbabilityExclusionEntry {
  type: 'low_probability_exclusion';
  edge_from: string;
  edge_to: string;
  exists_probability: number;
  threshold: number;
  timestamp: string;
}
```

---

## 4. Transform Ledger Points

### LP-TRANS-001: Seed Derivation
**Location**: `src/routes/v2/run.ts:264-279`
**Trigger**: Request has no seed, derived from graph hash

**Ledger Entry Schema**:
```typescript
interface SeedDerivationEntry {
  type: 'seed_derivation';
  graph_hash: string;
  derived_seed: string;
  hash_scope: string[];
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "seed_derivation",
  "graph_hash": "a1b2c3d4e5f6...",
  "derived_seed": "12345678",
  "hash_scope": ["node.id", "node.kind", "node.observed_state.value", "edge.from", "edge.to", "edge.strength.mean"],
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

### LP-TRANS-002: Factor Influence Computation
**Location**: `src/lib/factor-influence.ts:247-301`
**Trigger**: Factor influence computed from graph paths

**Ledger Entry Schema**:
```typescript
interface InfluenceComputationEntry {
  type: 'influence_computation';
  factor_id: string;
  goal_id: string;
  paths_found: number;
  raw_influence: number;
  normalised_influence: number;
  confidence: number;
  direction: 'positive' | 'negative';
  timestamp: string;
}
```

### LP-TRANS-003: Response Hash Computation
**Location**: `src/routes/v2/run.ts:1244`
**Trigger**: Response hash computed from canonical request

**Ledger Entry Schema**:
```typescript
interface HashComputationEntry {
  type: 'hash_computation';
  request_id: string;
  seed_used: string;
  response_hash: string;
  hash_algorithm: 'sha256';
  timestamp: string;
}
```

---

## 5. _meta.repairs_applied Integration

### 5.1 Aggregation Strategy
Repairs should be aggregated into the `_meta.repairs_applied` array in the response:

```typescript
interface CanonicalMeta {
  source_path: 'isl' | 'graph_fallback';
  repairs_applied: RepairRecord[];
  request_id: string;
  plot_build: string;
}

interface RepairRecord {
  field: string;
  action: 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived';
  from_value: number | string | null;
  to_value: number | string;
  reason: string;
}
```

### 5.2 Ledger Point → RepairRecord Mapping

| Ledger Point | RepairRecord.field | RepairRecord.action |
|--------------|-------------------|---------------------|
| LP-REPAIR-001 (clamp) | `edge.{field}` | `clamped` |
| LP-REPAIR-001 (default) | `edge.{field}` | `defaulted` |
| LP-REPAIR-001 (floor) | `edge.{field}` | `floored` |
| LP-REPAIR-002 | `edge.effect_direction` | `inferred` |
| LP-REPAIR-003 | `edge.{field}` | `derived` |

### 5.3 Implementation Location
The repair collection should occur in `normaliseGraph()` and be returned alongside the graph:

```typescript
interface NormalisationResult {
  graph: EngineGraphV3;
  nodesNormalised: number;
  edgesNormalised: number;
  warnings: NormalisationWarning[];
  repairs: RepairRecord[];  // New field
}
```

---

## 6. Feature Flag

**Flag Name**: `UI_CANONICAL_META`
**Default**: `0` (disabled)
**Enable**: `UI_CANONICAL_META=1`

When enabled:
- `_meta` object is added to response
- `repairs_applied` is populated from ledger points
- `source_path` indicates ISL vs graph fallback

---

## 7. Observability

### 7.1 Metrics
- `plot_repairs_total{type, action}` - Counter of repairs by type and action
- `plot_filters_total{type}` - Counter of filter operations
- `plot_transforms_total{type}` - Counter of transform operations

### 7.2 Logging
Each ledger point should emit a structured log at `debug` level:
```json
{
  "level": "debug",
  "evt": "ledger_entry",
  "request_id": "...",
  "entry": { /* ledger entry */ }
}
```

---

## 8. Test Coverage

Invariant tests covering ledger points:

| Ledger Point | Test File | Test Pattern |
|--------------|-----------|--------------|
| LP-REPAIR-001 | `normalisation.invariants.test.ts` | `INV-NORM-06` |
| LP-REPAIR-002 | `normalisation.invariants.test.ts` | `INV-NORM-06` |
| LP-REPAIR-003 | `normalisation.invariants.test.ts` | `INV-NORM-04` |
| LP-FILTER-001 | `filter.invariants.test.ts` | `INV-FILTER-01` |
| LP-FILTER-002 | `filter.invariants.test.ts` | `INV-FILTER-02` |
| LP-FILTER-003 | `transform.invariants.test.ts` | `INV-TRANS-08` |
| LP-TRANS-001 | Integration tests | Seed derivation |
| LP-TRANS-002 | `transform.invariants.test.ts` | `INV-TRANS-01` |
| LP-TRANS-003 | Integration tests | Response hash |

---

## Appendix: Warning Code Reference

Current warning codes that should map to ledger entries:

| Warning Code | Ledger Point | Notes |
|--------------|--------------|-------|
| `COEFFICIENT_REPAIRED` | LP-REPAIR-001, LP-REPAIR-003 | Covers clamp/default/floor/derive |
| `DIRECTION_INFERRED` | LP-REPAIR-002 | Effect direction inference |
| `UNKNOWN_NODE_KIND` | (informational) | Not a repair, warning only |
| `NORMALIZATION_WARNING` | (informational) | Option node warning |
