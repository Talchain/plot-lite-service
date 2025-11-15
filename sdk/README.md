# @talchain/plot-lite-sdk

TypeScript SDK for PLoT Lite inference engine with full support for priors, evidence, and timeslices.

## Installation

```bash
npm install @talchain/plot-lite-sdk
```

## Quick Start

```typescript
import { PlotLiteClient } from '@talchain/plot-lite-sdk';

const client = new PlotLiteClient('http://localhost:3000');

// Basic inference
const result = await client.run({
  graph: {
    nodes: [{ id: 'A', label: 'Price' }, { id: 'B', label: 'Demand' }],
    edges: [{ from: 'A', to: 'B', weight: -0.8 }]
  },
  seed: 4242
});

console.log(result.summary); // { p10, p50, p90 }
```

## Features

- ✅ **7 Inference Methods**: run, compare, inspect, intervene, optimise, runBundle, runTimeslices
- ✅ **Priors Support**: Number and distribution formats with validation (⚠️ validation-only in v1.6.0)
- ✅ **Evidence Annotations**: Attach evidence with source tracking
- ✅ **Timeslices**: Temporal graph evaluation (up to 12 slices)
- ✅ **TypeScript Types**: Full type definitions for all requests/responses
- ✅ **Client-side Validation**: Catch errors before API calls
- ✅ **Dual Build**: ESM and CommonJS support
- ✅ **Browser & Node**: Works in both environments

## API Methods

### run(request)
Basic causal inference on a graph.

```typescript
const result = await client.run({
  graph: { nodes: [...], edges: [...] },
  priors: { node_A: 0.6 },
  evidence: [{ node_id: 'node_A', source: 'survey_2024' }],
  seed: 4242
});
```

### runTimeslices(request)
Evaluate graph across multiple time periods (max 12 slices).

```typescript
const result = await client.runTimeslices({
  graph: { nodes: [...], edges: [...] },
  timeslices: ['Q1', 'Q2', 'Q3', 'Q4'],
  slice_overrides: [
    { slice: 'Q2', nodes: [{ id: 'demand', value: 1.2 }] }
  ],
  priors: { demand: 0.6 },
  seed: 4242
});
```

### optimise(request)
Budget-constrained action optimization.

```typescript
const result = await client.optimise({
  graph: { nodes: [...], edges: [...] },
  budget: 1000,
  actions: [
    { id: 'action1', cost: 500, do: [{ node_id: 'A', set_to: 1.2 }] }
  ],
  objective: {
    type: 'utility_linear',
    weights: { revenue: 0.6, satisfaction: 0.4 }
  },
  seed: 4242
});
```

### compare(request)
Compare multiple graph scenarios.

```typescript
const result = await client.compare({
  graphs: [graph1, graph2, graph3],
  labels: ['Baseline', 'Scenario A', 'Scenario B'],
  seed: 4242
});
```

### intervene(request)
Causal intervention analysis.

```typescript
const result = await client.intervene({
  graph: { nodes: [...], edges: [...] },
  actions: [{ node_id: 'price', set_to: 1.2 }],
  outcome_node: 'revenue',
  seed: 4242
});
```

### inspect(request)
Graph structure inspection.

```typescript
const result = await client.inspect({
  graph: { nodes: [...], edges: [...] },
  seed: 4242
});
```

### runBundle(request)
Evaluate multiple graph variations.

```typescript
const result = await client.runBundle({
  base_graph: { nodes: [...], edges: [...] },
  deltas: [
    { label: 'Variant A', nodes: [{ id: 'A', value: 1.1 }] },
    { label: 'Variant B', nodes: [{ id: 'B', value: 0.9 }] }
  ],
  seed: 4242
});
```

### getLimits()
Get service capacity limits.

```typescript
const limits = await client.getLimits();
// { max_nodes: 50, max_edges: 200, max_payload_bytes: 98304 }
```

### health()
Check service health.

```typescript
const health = await client.health();
// { status: 'ok', version: '1.6.0', uptime_seconds: 12345 }
```

## Priors

Priors initialize node beliefs. Two formats supported:

**Number format** (0-1):
```typescript
priors: {
  node_A: 0.6,
  node_B: 0.3
}
```

**Distribution format** (mean + sd):
```typescript
priors: {
  node_A: { mean: 0.6, sd: 0.1 },
  node_B: { mean: 0.3, sd: 0.05 }
}
```

**Validation rules:**
- Number: Must be between 0 and 1
- Distribution: mean ∈ [0,1], sd > 0
- Node must exist in graph

## Evidence

Evidence annotations attach metadata to requests:

```typescript
evidence: [
  {
    node_id: 'demand',
    source: 'survey_2024',      // Required, ≤200 chars
    note: 'High confidence',     // Optional, ≤500 chars (not in response)
    weight: 0.8                  // Optional, 0-1
  }
]
```

**Response includes sanitized evidence** (notes removed):
```typescript
{
  schema: 'run.v1',
  summary: { ... },
  meta: {
    evidence_applied: [
      { node_id: 'demand', source: 'survey_2024', weight: 0.8 }
    ]
  }
}
```

## Client-side Validation

The SDK validates requests before sending to the server:

```typescript
try {
  await client.run({
    graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
    priors: { Z: 0.5 }  // Node 'Z' doesn't exist
  });
} catch (error) {
  console.error(error.message);
  // "Validation failed: Prior references unknown node: Z (priors.Z)"
}
```

## Error Handling

```typescript
try {
  const result = await client.run({ ... });
} catch (error) {
  if (error.message.includes('timeout')) {
    // Handle timeout
  } else if (error.message.includes('Validation failed')) {
    // Handle validation error
  } else {
    // Handle other errors
  }
}
```

## Configuration

```typescript
const client = new PlotLiteClient('http://localhost:3000', {
  timeout: 60000,  // 60 seconds (default: 30000)
  headers: {
    'Authorization': 'Bearer token',
    'X-Custom-Header': 'value'
  }
});
```

## Examples

See the [examples](./examples) directory for complete working examples:
- [Node.js Examples](./examples/node/)
  - `basic-run.ts` - Simple inference
  - `timeslices.ts` - Temporal evaluation with priors/evidence
- [Browser Examples](./examples/browser/)
  - `basic.html` - Browser usage

## TypeScript Support

Full TypeScript definitions included:

```typescript
import type { 
  RunRequest, 
  RunResponse,
  Priors,
  Evidence 
} from '@talchain/plot-lite-sdk';

const request: RunRequest = {
  graph: { nodes: [...], edges: [...] },
  priors: { A: 0.6 },
  seed: 4242
};
```

## Building from Source

```bash
git clone https://github.com/talchain/plot-lite-service
cd plot-lite-service/sdk
npm install
npm run build
npm test
```

## License

MIT
