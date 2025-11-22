# UI Handoff: PLoT Engine Debug Features

## Overview

The PLoT engine exposes optional debug data when clients send `include_debug: true` in requests. This data is **excluded from the deterministic hash** and provides transparency into the engine's decision-making process.

## Enabling Debug Data

### Request
```json
{
  "graph": { ... },
  "seed": 4242,
  "k_samples": 1000,
  "include_debug": true
}
```

### Server-Side Flags
- `COMPARE_VIEW_ENABLE=1` - Enables P1A (Option Compare)
- `INSPECTOR_DEBUG_ENABLE=1` - Enables P1B (Inspector)

Both flags must be ON **and** client must send `include_debug: true`.

---

## P1A: Option Compare (Sensitivity Analysis)

### Purpose
Shows which edges have the most influence on each outcome node's result.

### Response Structure
```json
{
  "debug": {
    "compare": {
      "Revenue": {
        "p10": 45.2,
        "p50": 67.8,
        "p90": 89.3,
        "top3_edges": [
          {
            "edge_id": "Price::Demand::0",
            "from": "Price",
            "to": "Demand",
            "label": "price_elasticity",
            "weight": -1.2,
            "belief": 0.95,
            "provenance": "user",
            "score": 1.14,
            "rank": 1
          },
          {
            "edge_id": "Demand::Revenue::1",
            "from": "Demand",
            "to": "Revenue",
            "label": "conversion",
            "weight": 0.8,
            "belief": 1.0,
            "provenance": "template",
            "score": 0.8,
            "rank": 2
          }
        ]
      }
    }
  }
}
```

### UI Rendering Suggestions

**Sensitivity Card per Outcome:**
```
Revenue Sensitivity
├─ Distribution: p10=45.2, p50=67.8, p90=89.3
└─ Top 3 Influential Edges:
   1. Price → Demand (score: 1.14)
      • Weight: -1.2
      • Belief: 95%
      • Source: user
   2. Demand → Revenue (score: 0.8)
      • Weight: 0.8
      • Belief: 100%
      • Source: template
```

**Visual Options:**
- Bar chart of top 3 scores
- Edge highlighting in graph visualization
- Tooltip showing belief/provenance on hover

---

## P1B: Inspector (Edge Metadata)

### Purpose
Exposes all edge metadata including belief (probability edge exists) and provenance (data source).

### Response Structure
```json
{
  "debug": {
    "inspector": {
      "edges": [
        {
          "edge_id": "Price::Demand::0",
          "from": "Price",
          "to": "Demand",
          "label": "price_elasticity",
          "weight": -1.2,
          "belief": 0.95,
          "provenance": "user"
        },
        {
          "edge_id": "Demand::Revenue::1",
          "from": "Demand",
          "to": "Revenue",
          "label": "conversion",
          "weight": 0.8,
          "belief": 1.0,
          "provenance": "template"
        }
      ]
    }
  }
}
```

### UI Rendering Suggestions

**Edge Inspector Table:**
```
| From    | To      | Weight | Belief | Source   |
|---------|---------|--------|--------|----------|
| Price   | Demand  | -1.2   | 95%    | user     |
| Demand  | Revenue | 0.8    | 100%   | template |
```

**Visual Options:**
- Edge thickness proportional to belief
- Color coding by provenance (user=blue, template=gray)
- Badge showing belief percentage
- Filter by provenance source

---

## Field Definitions

### Common Fields
- **edge_id**: Unique identifier `{from}::{to}::{index}`
- **from**: Source node ID
- **to**: Target node ID
- **label**: Human-readable edge description (optional)
- **weight**: Edge strength (-∞ to +∞)

### P1A Specific
- **score**: Sensitivity score = `|weight| × belief`
- **rank**: 1-3 (most influential edges)
- **p10/p50/p90**: Outcome percentiles

### P1B Specific
- **belief**: Probability edge exists (0.0 to 1.0)
  - 1.0 = certain
  - 0.0 = uncertain
- **provenance**: Data source (max 100 chars)
  - "user" = user-provided
  - "template" = system default
  - "ml_model" = ML-derived
  - Custom sources allowed

---

## Default Behavior

When flags are OFF or `include_debug` is false/omitted:
- `debug` field is **absent** from response
- No performance impact
- Hash remains deterministic

---

## Performance Notes

- Debug data adds ~5-10ms to response time
- No impact on core outcomes or hash
- Safe to enable in production
- Recommended: Enable only when user requests it

---

## Error Handling

If debug is requested but flags are OFF:
- Request succeeds normally
- `debug` field is absent (not an error)
- Client should handle gracefully

---

## Example Integration

```typescript
// Request with debug
const response = await fetch('/v1/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    graph: myGraph,
    seed: 4242,
    k_samples: 1000,
    include_debug: true
  })
});

const data = await response.json();

// Check if debug data is available
if (data.debug?.compare) {
  // Render P1A sensitivity analysis
  renderSensitivity(data.debug.compare);
}

if (data.debug?.inspector) {
  // Render P1B edge inspector
  renderInspector(data.debug.inspector);
}
```

---

## Production Checklist

- [ ] Server flags enabled: `COMPARE_VIEW_ENABLE=1`, `INSPECTOR_DEBUG_ENABLE=1`
- [ ] Client sends `include_debug: true` when user requests debug view
- [ ] UI gracefully handles absent `debug` field
- [ ] Debug view clearly labeled as "Advanced" or "Developer"
- [ ] Performance acceptable with debug enabled

---

**Version:** v1.0  
**Last Updated:** 2025-11-01  
**Contact:** PLoT Engine Team
