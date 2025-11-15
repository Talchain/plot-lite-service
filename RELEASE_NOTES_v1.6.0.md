# Release Notes v1.6.0

**Release Date**: 2025-11-15  
**Codename**: Timeslices, Priors & Evidence  
**Status**: ✅ Ready for Production

---

## 🎯 Overview

Version 1.6.0 introduces three major feature sets that enhance the PLoT Lite inference engine with temporal evaluation, belief initialization, and evidence tracking capabilities. This release maintains full backwards compatibility while adding powerful new capabilities for causal modeling.

---

## ✨ New Features

### 1. Timeslices Endpoint (`/v1/run_timeslices`)

Evaluate graphs across multiple time periods with optional per-slice overrides.

**Key Capabilities:**
- Up to 12 timeslices per request
- Optional node/edge overrides per slice
- Deterministic results with seed
- Full priors and evidence support

**Example:**
```typescript
POST /v1/run_timeslices
{
  "graph": {
    "nodes": [{ "id": "demand", "label": "Demand" }],
    "edges": []
  },
  "timeslices": ["Q1_2024", "Q2_2024", "Q3_2024", "Q4_2024"],
  "slice_overrides": [
    {
      "slice": "Q2_2024",
      "nodes": [{ "id": "demand", "value": 1.2 }]
    }
  ],
  "priors": { "demand": 0.6 },
  "seed": 4242
}
```

**Response:**
```typescript
{
  "schema": "run_timeslices.v1",
  "results": [
    {
      "slice": "Q1_2024",
      "summary": { "p10": 0.45, "p50": 0.60, "p90": 0.75 },
      "confidence": 0.85
    },
    // ... more slices
  ],
  "model_card": {
    "seed": 4242,
    "response_hash": "abc123...",
    "timeslices_count": 4
  }
}
```

**Limits:**
- Maximum 12 timeslices per request
- Standard graph limits apply (50 nodes, 200 edges)
- Performance: p95 < 800ms for 12 slices

---

### 2. Priors Support

Initialize node beliefs with prior probabilities or distributions.

**Supported Formats:**

**Number Format** (0-1):
```typescript
{
  "priors": {
    "node_A": 0.6,
    "node_B": 0.3
  }
}
```

**Distribution Format** (mean + standard deviation):
```typescript
{
  "priors": {
    "node_A": { "mean": 0.6, "sd": 0.1 },
    "node_B": { "mean": 0.3, "sd": 0.05 }
  }
}
```

**Validation Rules:**
- Number: Must be between 0 and 1
- Distribution: `mean` ∈ [0,1], `sd` > 0
- Node must exist in graph

**Supported Endpoints:**
- `/v1/run`
- `/v1/optimise`
- `/v1/run_bundle`
- `/v1/run_timeslices`

---

### 3. Evidence Annotations

Attach evidence metadata to requests for audit trails and transparency.

**Structure:**
```typescript
{
  "evidence": [
    {
      "node_id": "demand",           // Required
      "source": "survey_2024",       // Required, ≤200 chars
      "note": "High confidence",     // Optional, ≤500 chars
      "weight": 0.8                  // Optional, 0-1
    }
  ]
}
```

**Response Echo:**
Evidence is sanitized and echoed in `meta.evidence_applied` (notes removed for security):
```typescript
{
  "schema": "run.v1",
  "summary": { ... },
  "meta": {
    "evidence_applied": [
      { "node_id": "demand", "source": "survey_2024", "weight": 0.8 }
    ]
  }
}
```

**Audit Trail:**
Evidence count is recorded in audit events for compliance.

**Supported Endpoints:**
- `/v1/run`
- `/v1/optimise`
- `/v1/run_bundle`
- `/v1/run_timeslices`

---

### 4. TypeScript SDK v0.5.0

Full-featured TypeScript SDK with client-side validation.

**Installation:**
```bash
npm install @talchain/plot-lite-sdk
```

**Quick Start:**
```typescript
import { PlotLiteClient } from '@talchain/plot-lite-sdk';

const client = new PlotLiteClient('http://localhost:3000');

// Run with priors and evidence
const result = await client.run({
  graph: { nodes: [...], edges: [...] },
  priors: { demand: 0.6 },
  evidence: [{ node_id: 'demand', source: 'survey_2024' }],
  seed: 4242
});
```

**Features:**
- ✅ 7 inference methods (run, compare, inspect, intervene, optimise, runBundle, runTimeslices)
- ✅ Full TypeScript types
- ✅ Client-side validation (priors, evidence, timeslices)
- ✅ Dual ESM/CJS build
- ✅ Browser and Node.js compatible
- ✅ Comprehensive documentation

**See:** `sdk/README.md` for full documentation

---

## 📋 API Changes

### New Endpoints
- `POST /v1/run_timeslices` - Temporal graph evaluation

### Extended Endpoints
The following endpoints now accept optional `priors` and `evidence` fields:
- `POST /v1/run`
- `POST /v1/optimise`
- `POST /v1/run_bundle`
- `POST /v1/run_timeslices`

### Backwards Compatibility
✅ **Fully backwards compatible** - All new fields are optional. Existing API contracts unchanged.

---

## 🔧 Technical Details

### Validation
- **Priors**: Validated for range (0-1), node existence, and distribution constraints
- **Evidence**: Validated for required fields, length limits, and node existence
- **Timeslices**: Maximum 12 per request

### Performance
- All endpoints meet existing p95 targets
- `/v1/run_timeslices`: p95 < 800ms (12 slices)
- No performance regression on existing endpoints

### Security & Privacy
- Evidence notes never logged (privacy)
- Sanitized evidence echo in responses
- Audit trail records evidence count
- No payload logging (structured logs only)

### Observability
- Structured logging: one line per request
- Request ID echoed in `X-Request-Id`
- Evidence count in audit events
- Deterministic `response_hash` for all responses

---

## 📊 Quality Metrics

### Test Coverage
- **Total Tests**: 789 passing (95.5%)
- **Feature Tests**: 24/24 passing (timeslices, priors, evidence)
- **SDK Tests**: Unit and integration tests included
- **OpenAPI**: Round-trip validation for all endpoints

### Performance
- All p95 gates maintained
- No latency regression
- Timeslices: < 800ms for 12 slices

### Documentation
- Complete OpenAPI spec with examples
- SDK documentation and examples
- UI wiring examples
- Migration guide

---

## 🚀 Migration Guide

### For Existing Users
No changes required. All new features are opt-in via optional fields.

### To Use New Features

**Timeslices:**
```typescript
// Before: Single evaluation
POST /v1/run { graph, seed }

// After: Multiple time periods
POST /v1/run_timeslices {
  graph,
  timeslices: ["Q1", "Q2", "Q3"],
  seed
}
```

**Priors:**
```typescript
// Add to any supported endpoint
{
  graph: { ... },
  priors: { node_A: 0.6 },  // or { mean: 0.6, sd: 0.1 }
  seed: 4242
}
```

**Evidence:**
```typescript
// Add to any supported endpoint
{
  graph: { ... },
  evidence: [
    { node_id: "A", source: "survey_2024", weight: 0.8 }
  ],
  seed: 4242
}
```

---

## 📖 Documentation

### Updated
- `README.md` - New features section
- `contracts/openapi.yaml` - Complete specs for all endpoints
- `sdk/README.md` - SDK documentation
- `ROADMAP_B_TO_E.md` - Implementation roadmap

### New
- `sdk/CHANGELOG.md` - SDK version history
- `RELEASE_NOTES_v1.6.0.md` - This document
- `PHASE_A_COMPLETE.md` - Phase A completion report
- `FINAL_ACCEPTANCE.md` - Acceptance summary

---

## 🎨 UI Wiring Examples

### Timeslices Editor
```typescript
// Max 12 timeslices with optional overrides
const request = {
  graph: { ... },
  timeslices: ["Q1", "Q2", "Q3", "Q4"],  // ≤ 12
  slice_overrides: [
    { slice: "Q2", nodes: [{ id: "demand", value: 1.2 }] }
  ],
  seed: 4242
};
```

### Optimise Dialog
```typescript
// Top-level budget takes precedence over constraints.budget
const request = {
  graph: { ... },
  budget: 1000,  // This wins
  actions: [...],
  objective: {
    type: "utility_linear",
    weights: { revenue: 0.6, satisfaction: 0.4 }  // Multi-target
  },
  constraints: { budget: 500 }  // Ignored
};
```

### Priors Inspector
```typescript
// Two formats supported
const request = {
  graph: { ... },
  priors: {
    node_A: 0.6,  // Simple number
    node_B: { mean: 0.7, sd: 0.1 }  // Distribution
  },
  seed: 4242
};
```

### Evidence Inspector
```typescript
// Request with evidence
const request = {
  graph: { ... },
  evidence: [
    {
      node_id: "node_A",
      source: "survey_2024",  // ≤200 chars
      note: "High confidence",  // ≤500 chars, NOT in response
      weight: 0.8  // 0-1
    }
  ],
  seed: 4242
};

// Response shows sanitized evidence (no notes)
const response = {
  schema: "run.v1",
  summary: { ... },
  meta: {
    evidence_applied: [
      { node_id: "node_A", source: "survey_2024", weight: 0.8 }
    ]
  }
};
```

---

## 🔗 Links

- **Repository**: https://github.com/Talchain/plot-lite-service
- **SDK**: `sdk/` directory
- **OpenAPI Spec**: `contracts/openapi.yaml`
- **Documentation**: `docs/` directory

---

## 👥 Contributors

This release was developed through the WP-B/C sprint, implementing timeslices (B1), priors (C1), and evidence (C2) features with comprehensive testing and documentation.

---

## 📝 Notes

### Known Limitations
- Timeslices: Maximum 12 per request
- Evidence notes: Not echoed in responses (privacy)
- Priors: Must reference existing nodes

### Future Enhancements
- Streaming support for long-running timeslices
- Batch timeslices API
- Enhanced prior distributions (beta, gamma)
- Evidence conflict detection

---

**Status**: ✅ Ready for Production  
**Confidence**: HIGH - All features tested, documented, and backwards compatible

---

*For detailed implementation notes, see `FINAL_ACCEPTANCE.md` and `ROADMAP_B_TO_E.md`*
