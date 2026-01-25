# Golden Fixtures

## Purpose

Catch boundary drift and regression in CI before it reaches staging. Validates data alignment across the ISL -> PLoT -> UI pipeline.

**Design Principle:** Minimal fixtures, maximum signal. We test the contract, not the implementation.

---

## Structure

```
tests/golden/
├── pricing-canary/              # Scenario: Pricing decision (CEE skipped)
│   ├── isl-response.json        # ISL computation results (source of truth)
│   └── plot-response.json       # PLoT -> UI canonical response (SSOT)
├── cee-enabled-decision/        # Scenario: Full pipeline (future)
│   ├── cee-response.json        # CEE graph generation
│   ├── isl-response.json
│   └── plot-response.json
├── golden.test.ts               # All assertions
└── README.md
```

### Why 2 Files (Not 4)?

| File | Verdict | Rationale |
|------|---------|-----------|
| `isl-response.json` | Keep | Source of truth for computation; enables passthrough assertions |
| `plot-response.json` | Keep | Canonical contract - the SSOT for what UI consumes |
| `cee-response.json` | Drop | CEE skipped in this scenario; CEE validation belongs in `cee-enabled-decision/` |
| `isl-request.json` | Drop | Derivative - if PLoT shapes it wrong, ISL response will be wrong |

---

## Scenarios

### `pricing-canary/` (Current)

| Aspect | Value |
|--------|-------|
| **Purpose** | Tests ISL->PLoT passthrough, fragility detection, semantic validity |
| **CEE mode** | Skipped (tests "graph-supplied" path) |
| **Graph** | 12 nodes, 18 edges |
| **Decision** | Pricing: Keep £49 vs Raise to £59 |
| **Canary qualification** | max(marginal_switch_probability) = 0.22 > 0.01 |
| **Captured from** | Debug bundle `97985a35` (2026-01-24) |

### `cee-enabled-decision/` (Future)

| Aspect | Value |
|--------|-------|
| **Purpose** | Tests full CEE->PLoT->ISL pipeline |
| **CEE mode** | Enabled (`cee_status: "success"`) |
| **Captures** | CEE structural integrity, CEE->PLoT alignment |

---

## Assertions

### Tier 1: Passthrough (ISL -> PLoT)

Validates that ISL computation results pass through PLoT unchanged.

| Assertion | Field | Method |
|-----------|-------|--------|
| marginal_switch_probability | `fragile_edges[*]` | ID-keyed equality |
| switch_probability | `fragile_edges[*]` | ID-keyed equality |
| recommendation_stability | `robustness` | Exact match |

### Tier 2: Semantic Validity

Validates that output values are mathematically coherent.

| Assertion | Rule |
|-----------|------|
| win_probability sums to ~1 | 0.98 <= sum <= 1.02 |
| confidence values | [0, 1] |
| value_of_information values | [0, 1] |
| VOI != confidence | For at least one factor |
| flip_risk_category | One of: `isolated`, `correlated`, `negligible` |
| outcomes in range | [-100, 100] |

### Tier 3: Subset Consistency

Validates structural alignment across boundaries.

| Assertion | Rule |
|-----------|------|
| PLoT fragile edges subset of ISL | Every PLoT edge_id exists in ISL |
| Option IDs preserved | PLoT options subset of ISL options |

### Tier 4: Canary Qualification

Ensures the fixture remains a valid regression trap.

| Assertion | Rule | Purpose |
|-----------|------|---------|
| max(marginal_switch_probability) > 0.01 | Threshold | Prevents accidentally swapping in too-stable fixture |

---

## Running Tests

```bash
npm test -- tests/golden/golden.test.ts
```

---

## Updating Fixtures

When the contract legitimately changes:

1. **Capture** new debug bundle from staging (with truncation disabled)
2. **Extract** payloads:
   ```bash
   python3 -c "
   import json
   with open('debug-bundle.json') as f: data = json.load(f)
   payloads = data['payloads']

   # ISL response
   with open('isl-response.json', 'w') as out:
       json.dump(payloads['isl_response'], out, indent=2)

   # PLoT response (strip diagnostic fields)
   plot = {k: v for k, v in payloads['plot_response'].items()
           if k not in ('downstream_calls', '_meta')}
   with open('plot-response.json', 'w') as out:
       json.dump(plot, out, indent=2)
   "
   ```
3. **Run tests** to verify assertions still valid
4. **Commit** with explanation of contract change

---

## What These Tests Catch

| Bug Type | Example | Caught By |
|----------|---------|-----------|
| Dropped field | `marginal_switch_probability` silently removed | Passthrough (Tier 1) |
| Schema drift | ISL adds field, PLoT doesn't forward | Subset (Tier 3) |
| Invalid data | Negative confidence value | Semantic (Tier 2) |
| Computation error | win_probability doesn't sum to 1 | Semantic (Tier 2) |
| Fixture decay | Canary becomes too stable | Canary (Tier 4) |

---

## What These Tests Don't Catch

| Gap | Reason | Mitigation |
|-----|--------|------------|
| CEE generation quality | CEE skipped in this scenario | Add `cee-enabled-decision/` scenario |
| Computation correctness | Tests contract, not algorithm | ISL unit tests |
| UI rendering | Tests data, not presentation | UI component tests |

---

## Schema Reference

These fixtures validate the **implementation contract** as of 2026-01-24. Key fields:

### `robustness`
```typescript
{
  recommendation_stability: number;  // [0, 1]
  fragile_edges: FragileEdge[];
  robust_edges: string[];
}
```

### `fragile_edges[*]`
```typescript
{
  edge_id: string;                      // "{from_id}->{to_id}"
  from_id: string;
  to_id: string;
  switch_probability: number | null;
  marginal_switch_probability: number;  // Key passthrough field
  alternative_winner_id: string | null;
  alternative_winner_label: string | null;
}
```

### `factor_sensitivity[*]`
```typescript
{
  factor_id: string;
  factor_label: string;
  influence_score: number;
  sensitivity_score: number;
  elasticity: number;
  direction: 'positive' | 'negative';
  importance_rank: number;
  value_of_information: number;         // [0, 1]
  confidence: number;                   // [0, 1]
  source: 'graph';
  flip_risk_category: 'isolated' | 'correlated' | 'negligible';
}
```

### `option_comparison[*]`
```typescript
{
  option_id: string;
  option_label: string;
  win_probability: number;              // [0, 1], sum ~ 1
  outcome: {
    mean: number;
    std: number;
    p10: number;
    p50: number;
    p90: number;
  };
}
```

---

## Document History

| Date | Change |
|------|--------|
| 2026-01-24 | Initial creation with 2-file structure |
