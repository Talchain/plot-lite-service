# PLoT Engine Integration Contract v1.2

_Last updated: 2025-12-05_

This document describes the `/v1/compare` endpoint for multi-graph scenario comparison, plus new additions in v1.2: `graph_health` and `critique.source`.

---

## /v1/compare - Multi-Graph Comparison

**Purpose:** Compare 2-5 complete graphs with full SCM-Lite inference to help users evaluate decision options side-by-side.

**Implementation:** [`src/routes/v1/compare.ts`](../src/routes/v1/compare.ts) - Uses real inference engine (not stubs).

### Request Schema

```typescript
POST /v1/compare
Content-Type: application/json

{
  graphs: Array<{
    graph: {
      nodes: Array<{ id: string; label: string; value?: number }>;
      edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
    };
    label: string;  // Human-readable scenario name
  }>;
  outcome_node?: string;  // Optional, defaults to last node in first graph
  baseline_value?: number; // Optional, defaults to 100
  seed?: number;  // Optional, defaults to 4242
}
```

**Limits:**
- 2-5 graphs required
- First graph is treated as baseline
- Same seed = deterministic results

### Response Schema

```typescript
{
  schema: "compare.v1";
  baseline: string;  // Label of baseline option
  options: Array<{
    label: string;
    p10: number;    // Conservative estimate (10th percentile)
    p50: number;    // Most likely estimate (median)
    p90: number;    // Optimistic estimate (90th percentile)
    top_drivers: Array<{
      node_id: string;
      node_label: string;
      sign: "+" | "-";
      contribution: number;  // Percentage contribution
    }>;
    delta: {
      p10: number;  // Difference from baseline p10
      p50: number;  // Difference from baseline p50
      p90: number;  // Difference from baseline p90
    };
    change_attribution?: ChangeAttribution;  // Only for non-baseline options
  }>;
  seed: number;
  model_card_subset: {
    determinism_note: string;
  };
}
```

### Change Attribution Schema

Explains **why** outcomes differ between scenarios:

```typescript
interface ChangeAttribution {
  outcome_delta: number;  // Net change in outcome (p50)
  primary_drivers: Array<{
    change_type: 'edge_added' | 'edge_removed' | 'edge_weight_changed' |
                 'node_value_changed' | 'node_added' | 'node_removed';
    description: string;  // Human-readable description
    contribution_to_delta: number;  // Absolute contribution
    contribution_pct: number;  // 0-100 percentage
    before_value?: number;  // For modifications
    after_value?: number;   // For modifications
    affected_nodes: Array<{ id: string; label: string }>;
  }>;
  summary: string;  // Human-readable summary
}
```

### Example Usage

**Comparing pricing strategies:**

```typescript
const response = await fetch('/v1/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    graphs: [
      {
        label: 'Current Pricing',
        graph: {
          nodes: [
            { id: 'price', label: 'Price Point', value: 100 },
            { id: 'volume', label: 'Sales Volume' },
            { id: 'revenue', label: 'Revenue' }
          ],
          edges: [
            { from: 'price', to: 'volume', weight: 0.8 },
            { from: 'volume', to: 'revenue', weight: 1.2 }
          ]
        }
      },
      {
        label: 'Raise 10%',
        graph: {
          nodes: [
            { id: 'price', label: 'Price Point', value: 110 },
            { id: 'volume', label: 'Sales Volume' },
            { id: 'revenue', label: 'Revenue' }
          ],
          edges: [
            { from: 'price', to: 'volume', weight: 0.6 },  // Lower volume sensitivity
            { from: 'volume', to: 'revenue', weight: 1.2 }
          ]
        }
      }
    ],
    seed: 42
  })
});

const result = await response.json();
// result.options[0]: Current Pricing - p50 = 100
// result.options[1]: Raise 10% - p50 = 108, delta.p50 = 8
// result.options[1].change_attribution.summary explains WHY
```

### Key Features

| Feature | Description |
|---------|-------------|
| Full inference | Uses complete SCM-Lite kernel (K=1000 samples) |
| Deterministic | Same graphs + seed = identical results |
| Delta calculation | Automatic baseline comparison |
| Change explanation | `change_attribution` shows structural differences |
| Parallel execution | All graphs run concurrently |

### Use Cases

| Scenario | Description |
|----------|-------------|
| Decision options | Compare "Do A" vs "Do B" scenarios |
| Sensitivity testing | Compare base vs stressed parameters |
| Version comparison | Before vs after graph changes |
| What-if analysis | Explore multiple interventions |

---

## New in v1.2: Graph Health

Added to `/v1/run` response to detect conditions that cause flat/collapsed analysis results.

### Response Field

```typescript
interface GraphHealth {
  variance_status: 'limited' | 'healthy' | 'unknown';
  issues?: Array<'uniform_weights' | 'uniform_beliefs' | 'single_path'>;
  suggestion?: string;
  source: 'engine' | 'isl';
}
```

### Issue Definitions

| Issue | Detection | Impact |
|-------|-----------|--------|
| `uniform_weights` | All edges have identical weight (or default 1.0) | No differentiation between causal paths |
| `uniform_beliefs` | All edges have identical belief (or default 0.7) | No variance in edge sampling |
| `single_path` | No node has >1 incoming or outgoing edge | Limited structural variance |

### Example Response

```json
{
  "graph_health": {
    "variance_status": "limited",
    "issues": ["uniform_weights", "uniform_beliefs"],
    "suggestion": "Vary edge weights and beliefs to reflect different influence strengths and certainties",
    "source": "engine"
  }
}
```

---

## New in v1.2: Critique Source

Critique items now include a `source` field indicating their origin:

```typescript
interface CritiqueItem {
  severity: 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';
  message: string;
  suggested_action?: string;
  auto_fixable?: boolean;
  source?: 'engine' | 'isl' | 'cee';  // NEW in v1.2
}
```

### Source Values

| Source | Description |
|--------|-------------|
| `engine` | Generated by PLoT Engine's local critique builder |
| `isl` | Generated from ISL validation/sensitivity results |
| `cee` | Generated by CEE orchestrator (future) |

---

## Change Control

- All changes are additive (no breaking changes)
- New fields are optional in responses
- Clients should gracefully handle missing optional fields
- Contract version: 1.2

---

## Related Documentation

- [OpenAPI Specification](../contracts/openapi.yaml)
- [Engine Architecture](./plot-lite-engine/10-architecture.md)
- [Error Codes](./engine/error-codes.md)
