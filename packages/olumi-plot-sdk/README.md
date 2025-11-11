# @olumi/plot-sdk

TypeScript SDK for PLoT Engine API.

## Installation

```bash
# From repo (not published to npm)
npm pack
npm install olumi-plot-sdk-0.1.0.tgz
```

## Usage

```typescript
import { limits, run } from '@olumi/plot-sdk';

// Get service limits
const limitsData = await limits();
console.log(limitsData.max_nodes); // 50

// Run inference
const result = await run({
  graph: {
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  },
  seed: 42,
});

console.log(result.result.summary); // { p10, p50, p90 }
```

## API

### `limits(options?)`
Returns service limits.

### `run(request, options?)`
Runs inference on a graph. Throws `OversizeError` if payload exceeds 96 KB.

### Options
- `baseUrl`: API base URL (default: production)
- `scmLite`: Enable SCM-Lite mode
- `idempotencyKey`: Optional idempotency key
