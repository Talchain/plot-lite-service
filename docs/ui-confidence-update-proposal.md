# UI Confidence Update Proposal

## Summary

Factor confidence is now computed using a single unified formula for all factors, regardless of whether the data comes from graph edge analysis or ISL bootstrap analysis. The UI needs two changes:

## Change 1: No code change needed for default display

The `confidence` field on each factor sensitivity entry now uses the unified formula regardless of source. Existing UI code that reads `confidence` will automatically show the unified value.

**Unified formula:**

```
confidence = clamp(0, 1,
  0.5 x attribution_stability_band_score +
  0.5 x mean(exists_probability of factor's incoming edges)
)
```

Where:
- `attribution_stability_band_score`: `high -> 1.0`, `moderate -> 0.5`, `low -> 0.0`, `negligible -> 0.0`. Defaults to `0.5` when ISL data is absent.
- `mean(exists_probability of incoming edges)`: mean of `exists_probability` on all directed edges where `edge.to === factor_id`. Defaults to `0.5` for root nodes (no incoming edges).

| Scenario | stability term | edge term | Result |
|----------|---------------|-----------|--------|
| ISL data + edges | Real band score | Real edge mean | Full signal from both |
| ISL data, no edges (root) | Real band score | 0.5 default | ISL-dominated |
| No ISL data + edges | 0.5 default | Real edge mean | Edge-dominated |
| No ISL data, no edges | 0.5 | 0.5 | Neutral (0.5) |

## Change 2: Progressive disclosure (optional, pilot enhancement)

New `confidence_components` field available on each factor. If the UI wants to let advanced users see what's behind the confidence number:

```
Confidence: 0.42
  |-- Structural certainty: 0.34 (from edge relationships)
  +-- Sampling stability: 0.50 (from Monte Carlo analysis)
```

Display this in an expandable section on the factor detail view or tooltip. Not required for pilot launch -- document as available for post-pilot UX refinement.

### Fields

```typescript
confidence_components?: {
  structural_certainty: number;    // mean(exists_probability of incoming edges), or 0.5 if no edges
  sampling_stability: number | null; // attribution_stability_band_score, or null if no ISL data
};
```

## Response shape change

**Important:** `confidence_source` now means "which raw data was available to the formula" -- NOT "which formula was used." Both sources use the same unified formula. Do not render `confidence_source` as a method indicator in the UI. It is a diagnostic field for debugging and progressive disclosure.

```typescript
// Before (two different formulas, same field name)
{ confidence: 0.358, confidence_source: 'graph' }   // path certainty formula
{ confidence: 0.318, confidence_source: 'isl' }      // bootstrap + CV formula

// After (one formula, raw components available)
{
  confidence: 0.42,
  confidence_source: 'graph',
  confidence_components: { structural_certainty: 0.34, sampling_stability: null }
}
{
  confidence: 0.35,
  confidence_source: 'isl',
  confidence_components: { structural_certainty: 0.20, sampling_stability: 0.50 }
}
```

## Breaking changes

None. `confidence` field type and range unchanged. `confidence_source` unchanged. `confidence_components` is additive.
