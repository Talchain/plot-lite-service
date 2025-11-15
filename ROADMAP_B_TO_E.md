# Roadmap: Phases B-E Implementation Plan

**Status**: Phase A Complete ✅ | Phases B-E Planned  
**Date**: 2025-11-15

---

## Phase B: SDK v0.5.x

### Scope
TypeScript SDK (dual ESM/CJS) with 7 typed methods and client-side validation.

### Implementation Plan

#### 1. SDK Structure
```
sdk/
├── src/
│   ├── index.ts (main exports)
│   ├── client.ts (PlotLiteClient class)
│   ├── types.ts (TypeScript interfaces)
│   ├── validators.ts (client-side validation)
│   └── errors.ts (error classes)
├── examples/
│   ├── node/
│   │   ├── basic-run.ts
│   │   ├── timeslices.ts
│   │   ├── priors-evidence.ts
│   │   └── optimise.ts
│   └── browser/
│       ├── basic.html
│       └── with-limits.html
├── tests/
│   ├── unit/
│   │   ├── validators.test.ts
│   │   └── request-builders.test.ts
│   └── integration/
│       └── live-server.test.ts
├── package.json
├── tsconfig.json
├── tsconfig.cjs.json
├── README.md
└── CHANGELOG.md
```

#### 2. Methods to Implement
```typescript
class PlotLiteClient {
  constructor(baseUrl: string, options?: ClientOptions)
  
  // Core methods
  async run(request: RunRequest): Promise<RunResponse>
  async compare(request: CompareRequest): Promise<CompareResponse>
  async inspect(request: InspectRequest): Promise<InspectResponse>
  async intervene(request: InterveneRequest): Promise<InterveneResponse>
  async optimise(request: OptimiseRequest): Promise<OptimiseResponse>
  async runBundle(request: RunBundleRequest): Promise<RunBundleResponse>
  async runTimeslices(request: RunTimeslicesRequest): Promise<RunTimeslicesResponse>
  
  // Utility methods
  async getLimits(): Promise<LimitsResponse>
  async health(): Promise<HealthResponse>
}
```

#### 3. Type Definitions
```typescript
// Priors support
type Prior = number | { mean: number; sd: number };
type Priors = Record<string, Prior>;

// Evidence support
interface Evidence {
  node_id: string;
  source: string;
  note?: string;
  weight?: number;
}

// Request types with priors/evidence
interface RunRequest {
  graph: Graph;
  seed?: number;
  priors?: Priors;
  evidence?: Evidence[];
  // ... other fields
}

interface RunTimeslicesRequest {
  graph: Graph;
  timeslices: string[];
  slice_overrides?: SliceOverride[];
  priors?: Priors;
  evidence?: Evidence[];
  seed?: number;
}
```

#### 4. Client-Side Validation
```typescript
// Mirror server-side validation
function validatePriors(priors: Priors, nodeIds: Set<string>): ValidationResult {
  // Check range (0-1 for numbers, sd > 0 for distributions)
  // Check node existence
  // Return structured errors with field pointers
}

function validateEvidence(evidence: Evidence[], nodeIds: Set<string>): ValidationResult {
  // Check required fields
  // Check length limits (source ≤200, note ≤500)
  // Check weight range (0-1)
  // Check node existence
}
```

#### 5. Build Configuration
```json
// package.json
{
  "name": "@talchain/plot-lite-sdk",
  "version": "0.5.0",
  "type": "module",
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts"
    }
  },
  "scripts": {
    "build": "npm run build:esm && npm run build:cjs && npm run build:types",
    "build:esm": "tsc -p tsconfig.json",
    "build:cjs": "tsc -p tsconfig.cjs.json",
    "build:types": "tsc -p tsconfig.json --declaration --emitDeclarationOnly --outDir dist/types",
    "test": "vitest",
    "test:integration": "vitest run tests/integration"
  }
}
```

#### 6. Examples

**Node Example** (`examples/node/timeslices.ts`):
```typescript
import { PlotLiteClient } from '@talchain/plot-lite-sdk';

const client = new PlotLiteClient('http://localhost:3000');

// Get limits first
const limits = await client.getLimits();
console.log('Max nodes:', limits.max_nodes);

// Run timeslices with priors and evidence
const result = await client.runTimeslices({
  graph: {
    nodes: [{ id: 'A', label: 'A' }],
    edges: []
  },
  timeslices: ['Q1', 'Q2', 'Q3'],
  priors: { A: 0.6 },
  evidence: [{ node_id: 'A', source: 'historical_data' }],
  seed: 4242
});

console.log('Results:', result.results);
```

**Browser Example** (`examples/browser/with-limits.html`):
```html
<!DOCTYPE html>
<html>
<head>
  <title>PLoT Lite SDK - Browser Example</title>
  <script type="module">
    import { PlotLiteClient } from './dist/esm/index.js';
    
    const client = new PlotLiteClient('http://localhost:3000');
    
    async function runExample() {
      try {
        // Check limits
        const limits = await client.getLimits();
        document.getElementById('limits').textContent = JSON.stringify(limits, null, 2);
        
        // Run with priors
        const result = await client.run({
          graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
          priors: { A: 0.7 },
          seed: 4242
        });
        
        document.getElementById('result').textContent = JSON.stringify(result, null, 2);
      } catch (error) {
        document.getElementById('error').textContent = error.message;
      }
    }
    
    window.runExample = runExample;
  </script>
</head>
<body>
  <h1>PLoT Lite SDK - Browser Example</h1>
  <button onclick="runExample()">Run Example</button>
  <h2>Limits</h2>
  <pre id="limits"></pre>
  <h2>Result</h2>
  <pre id="result"></pre>
  <h2>Error</h2>
  <pre id="error"></pre>
</body>
</html>
```

#### 7. Tests

**Unit Test** (`tests/unit/validators.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { validatePriors, validateEvidence } from '../../src/validators';

describe('Priors Validation', () => {
  it('accepts valid number priors', () => {
    const result = validatePriors({ A: 0.6 }, new Set(['A']));
    expect(result.valid).toBe(true);
  });
  
  it('rejects out-of-range priors', () => {
    const result = validatePriors({ A: 1.5 }, new Set(['A']));
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('priors.A');
  });
});
```

**Integration Test** (`tests/integration/live-server.test.ts`):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { PlotLiteClient } from '../../src';

describe('Live Server Integration', () => {
  let client: PlotLiteClient;
  
  beforeAll(() => {
    client = new PlotLiteClient('http://localhost:3000');
  });
  
  it('runs with priors and evidence', async () => {
    const result = await client.run({
      graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
      priors: { A: 0.6 },
      evidence: [{ node_id: 'A', source: 'test' }],
      seed: 4242
    });
    
    expect(result.schema).toBe('run.v1');
    expect(result.summary).toBeDefined();
  });
  
  it('runs timeslices', async () => {
    const result = await client.runTimeslices({
      graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
      timeslices: ['T1', 'T2'],
      seed: 4242
    });
    
    expect(result.schema).toBe('run_timeslices.v1');
    expect(result.results.length).toBe(2);
  });
});
```

#### 8. Documentation

**README.md**:
```markdown
# @talchain/plot-lite-sdk

TypeScript SDK for PLoT Lite inference engine.

## Installation

```bash
npm install @talchain/plot-lite-sdk
```

## Quick Start

```typescript
import { PlotLiteClient } from '@talchain/plot-lite-sdk';

const client = new PlotLiteClient('http://localhost:3000');

// Basic run
const result = await client.run({
  graph: { nodes: [...], edges: [...] },
  seed: 4242
});

// With priors
const resultWithPriors = await client.run({
  graph: { nodes: [...], edges: [...] },
  priors: { node_A: 0.6, node_B: { mean: 0.7, sd: 0.1 } },
  seed: 4242
});

// With evidence
const resultWithEvidence = await client.run({
  graph: { nodes: [...], edges: [...] },
  evidence: [
    { node_id: 'node_A', source: 'survey_2024', weight: 0.8 }
  ],
  seed: 4242
});

// Timeslices
const timeslicesResult = await client.runTimeslices({
  graph: { nodes: [...], edges: [...] },
  timeslices: ['Q1', 'Q2', 'Q3'],
  seed: 4242
});
```

## Features

- ✅ 7 inference methods (run, compare, inspect, intervene, optimise, runBundle, runTimeslices)
- ✅ TypeScript types for all requests and responses
- ✅ Client-side validation (priors, evidence, limits)
- ✅ Dual ESM/CJS support
- ✅ Browser and Node.js compatible
- ✅ Deterministic results with seed
- ✅ Error handling with field pointers

## API Reference

See [API.md](./API.md) for full API documentation.

## Examples

- [Node.js Examples](./examples/node/)
- [Browser Examples](./examples/browser/)

## License

MIT
```

**CHANGELOG.md**:
```markdown
# Changelog

## [0.5.0] - 2025-11-15

### Added
- Initial release
- Support for 7 inference methods
- Priors support (number and distribution formats)
- Evidence annotations
- Timeslices endpoint
- Client-side validation
- TypeScript types
- Dual ESM/CJS build
- Node and browser examples
- Integration tests

### Features
- `run()` - Basic inference
- `compare()` - Compare scenarios
- `inspect()` - Graph inspection
- `intervene()` - Causal interventions
- `optimise()` - Budget optimization
- `runBundle()` - Scenario bundles
- `runTimeslices()` - Temporal evaluation
- `getLimits()` - Get service limits
- `health()` - Health check
```

### Acceptance

```
ACCEPT:SDK 
  v0.5.0 
  methods=7 
  types=priors+evidence 
  samples=node+browser 
  docs=updated 
  ci=green
```

---

## Phase C: OpenAPI & Examples Perfection

### Scope
Ensure all endpoints are under `paths:`, add/verify examples and error examples, CI validation.

### Implementation Plan

#### 1. OpenAPI Structure Validation
- Verify all endpoints under `paths:` (not `components:`)
- Add missing endpoints: `/v1/run_timeslices`
- Update existing endpoints with priors/evidence fields

#### 2. Examples for Each Endpoint
```yaml
paths:
  /v1/run:
    post:
      requestBody:
        content:
          application/json:
            example:
              graph: { nodes: [...], edges: [...] }
              priors: { node_A: 0.6 }
              evidence: [{ node_id: "node_A", source: "test" }]
              seed: 4242
            examples:
              basic:
                value: { graph: {...}, seed: 4242 }
              with_priors:
                value: { graph: {...}, priors: {...}, seed: 4242 }
              with_evidence:
                value: { graph: {...}, evidence: [...], seed: 4242 }
      responses:
        '200':
          content:
            application/json:
              example: { schema: "run.v1", summary: {...} }
        '400':
          content:
            application/json:
              examples:
                invalid_prior:
                  value: { error: { type: "BAD_INPUT", message: "Prior value must be between 0 and 1", field: "priors.node_A" } }
                invalid_evidence:
                  value: { error: { type: "BAD_INPUT", message: "source is required", field: "evidence[0].source" } }
```

#### 3. CI Validation Job
```yaml
# .github/workflows/openapi-validation.yml
name: OpenAPI Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Validate OpenAPI Structure
        run: npm run openapi:validate
      - name: Round-trip Examples
        run: npm run openapi:roundtrip
```

#### 4. Round-trip Tests
```typescript
// tests/openapi-roundtrip.test.ts
describe('OpenAPI Round-trip', () => {
  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const [method, spec] of Object.entries(methods)) {
      if (spec.requestBody?.content?.['application/json']?.example) {
        it(`${method.toUpperCase()} ${path} - example round-trips`, async () => {
          const example = spec.requestBody.content['application/json'].example;
          const res = await fetch(`${baseUrl}${path}`, {
            method: method.toUpperCase(),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(example)
          });
          expect(res.ok).toBe(true);
        });
      }
    }
  }
});
```

### Acceptance

```
ACCEPT:OPENAPI 
  structure=paths_only 
  examples=complete 
  error_examples=complete 
  roundtrip=green
```

---

## Phase D: Performance & Observability Polish

### Scope
Maintain p95 gates, add perf trends, verify structured logging.

### Implementation Plan

#### 1. Performance Gates
```typescript
// tests/perf-gates.test.ts
describe('Performance Gates', () => {
  const RUNS = 10;
  
  it('/v1/run p95 ≤ 600ms', async () => {
    const times = await runMultiple(RUNS, () => client.run({...}));
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThanOrEqual(600);
  });
  
  it('/v1/run_timeslices p95 ≤ 800ms (12 slices)', async () => {
    const times = await runMultiple(RUNS, () => client.runTimeslices({
      timeslices: Array(12).fill(0).map((_, i) => `T${i}`)
    }));
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThanOrEqual(800);
  });
});
```

#### 2. Performance Trends HTML
```typescript
// tools/perf-trends.ts
// Collate last N perf artifacts into static HTML
// Upload to CI artifacts
```

#### 3. Structured Logging Verification
```typescript
// tests/logging-conformance.test.ts
describe('Structured Logging', () => {
  it('logs one line per request with required fields', async () => {
    const logs = [];
    // Capture logs
    await client.run({...});
    
    const logLine = logs.find(l => l.evt === 'run');
    expect(logLine).toBeDefined();
    expect(logLine.id).toBeDefined();
    expect(logLine.route).toBe('/v1/run');
    expect(logLine.duration_ms).toBeTypeOf('number');
    expect(logLine.nodes).toBeTypeOf('number');
    expect(logLine.edges).toBeTypeOf('number');
    expect(logLine.seed).toBeDefined();
    
    // No payloads
    expect(JSON.stringify(logs)).not.toContain('graph');
    expect(JSON.stringify(logs)).not.toContain('priors');
  });
});
```

### Acceptance

```
ACCEPT:PERF 
  p95_gates=all_endpoints 
  trends=html_artefact 
  logs=single_line 
  no_payloads=true
```

---

## Phase E: Docs, Release & Handoff

### Scope
README updates, UI wiring examples, release notes, tags.

### Implementation Plan

#### 1. README Updates
```markdown
# PLoT-lite Service

## New Features (v1.6.0)

### Timeslices
Evaluate graphs across multiple time periods:
```typescript
POST /v1/run_timeslices
{
  "graph": {...},
  "timeslices": ["Q1_2024", "Q2_2024", "Q3_2024"],
  "seed": 4242
}
```

### Priors
Initialize beliefs with priors:
```typescript
POST /v1/run
{
  "graph": {...},
  "priors": {
    "node_A": 0.6,  // Number format
    "node_B": { "mean": 0.7, "sd": 0.1 }  // Distribution format
  },
  "seed": 4242
}
```

### Evidence
Annotate requests with evidence:
```typescript
POST /v1/run
{
  "graph": {...},
  "evidence": [
    {
      "node_id": "node_A",
      "source": "survey_2024",
      "note": "High confidence",
      "weight": 0.8
    }
  ],
  "seed": 4242
}
```
```

#### 2. UI Wiring Examples
```markdown
## UI Integration Examples

### Optimise Dialog
```typescript
// Budget precedence: top-level budget wins
const request = {
  graph: {...},
  budget: 1000,  // Top-level budget takes precedence
  actions: [...],
  objective: {
    type: 'utility_linear',
    weights: { revenue: 0.6, satisfaction: 0.4 }  // Multi-target utility
  },
  constraints: { budget: 500 }  // Ignored in favor of top-level
};
```

### Timeslices Editor
```typescript
// Max 12 timeslices
const request = {
  graph: {...},
  timeslices: ['Q1', 'Q2', 'Q3', 'Q4'],  // ≤ 12
  slice_overrides: [
    { slice: 'Q2', nodes: [{ id: 'demand', value: 1.2 }] }
  ]
};
```

### Priors/Evidence Inspector
```typescript
// Show sanitized evidence in response
const response = {
  schema: "run.v1",
  summary: {...},
  meta: {
    evidence_applied: [
      { node_id: "A", source: "survey_2024", weight: 0.8 }
      // Note: 'note' field removed for security
    ]
  }
};
```
```

#### 3. Release Notes
```markdown
# Release Notes v1.6.0

## New Features

### Timeslices Endpoint
- `POST /v1/run_timeslices` for temporal graph evaluation
- Supports up to 12 timeslices with optional overrides
- Deterministic results with seed

### Priors Support
- Added to `/v1/run`, `/v1/optimise`, `/v1/run_bundle`, `/v1/run_timeslices`
- Two formats: number (0-1) or distribution `{mean, sd}`
- Client-side and server-side validation

### Evidence Annotations
- Attach evidence to requests with `{node_id, source, note?, weight?}`
- Sanitized echo in `meta.evidence_applied` (no notes)
- Audit trail records evidence count

## API Changes

### Backwards Compatible
All new fields are optional. Existing API contracts unchanged.

### New Endpoints
- `POST /v1/run_timeslices`

### Extended Endpoints
- `/v1/run` - Now accepts `priors` and `evidence`
- `/v1/optimise` - Now accepts `priors` and `evidence`
- `/v1/run_bundle` - Now accepts `priors` and `evidence`

## Performance
- All endpoints meet p95 targets
- `/v1/run_timeslices`: p95 < 800ms (12 slices)

## Documentation
- Updated README with examples
- SDK v0.5.0 released
- OpenAPI spec updated

## Migration Guide
See MIGRATION.md for upgrade instructions.
```

#### 4. Tagging
```bash
# Engine release
git tag -a v1.6.0 -m "Release v1.6.0: Timeslices, Priors, Evidence"
git push origin v1.6.0

# SDK release (if published)
cd sdk
git tag -a v0.5.0 -m "Release v0.5.0: Initial SDK with priors/evidence support"
git push origin v0.5.0
```

### Acceptance

```
ACCEPT:RELEASE 
  engine=v1.6.0 
  notes=published 
  sdk=v0.5.0 
  published_if_applicable
```

---

## Timeline

- **Phase A**: ✅ Complete
- **Phase B**: 2-3 days (SDK development)
- **Phase C**: 1 day (OpenAPI updates)
- **Phase D**: 1 day (Perf & observability)
- **Phase E**: 1 day (Docs & release)

**Total**: 5-6 days for Phases B-E

---

## Dependencies

### Phase B (SDK)
- No blockers
- Can start immediately

### Phase C (OpenAPI)
- Requires Phase B examples for validation
- Can run in parallel with Phase B

### Phase D (Perf)
- Requires Phase B for integration tests
- Can run in parallel with Phase C

### Phase E (Release)
- Requires Phases B, C, D complete
- Final integration and tagging

---

## Success Criteria

### Phase B
- ✅ SDK published to npm (or ready for publishing)
- ✅ 7 methods implemented with types
- ✅ Client-side validation working
- ✅ Examples running
- ✅ Integration tests passing

### Phase C
- ✅ All endpoints under `paths:`
- ✅ Examples and error examples complete
- ✅ Round-trip tests passing in CI

### Phase D
- ✅ All p95 gates met
- ✅ Performance trends HTML generated
- ✅ Structured logging verified
- ✅ No payload logging

### Phase E
- ✅ README updated with examples
- ✅ Release notes published
- ✅ Tags created (v1.6.0 engine, v0.5.0 SDK)
- ✅ UI wiring examples documented

---

**Status**: Roadmap Complete | Ready for Execution
