# @olumi/plot-sdk

TypeScript SDK for PLoT Engine API. Works in both Node.js and browsers.

## Installation

```bash
npm install @olumi/plot-sdk
```

## Usage

```typescript
import { limits, run, compare, inspect } from '@olumi/plot-sdk';

// Get service limits
const limitsData = await limits();
console.log(limitsData.max_nodes); // 50

// Run inference
const result = await run({
  graph: {
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
  },
  seed: 42,
});

// Compare options
const comparison = await compare({
  graphs: [
    { graph: { nodes: [{ id: 'a', label: 'Option A' }], edges: [] }, label: 'A' },
    { graph: { nodes: [{ id: 'b', label: 'Option B' }], edges: [] }, label: 'B' }
  ],
  seed: 42
});

// Inspect graph
const inspection = await inspect({
  graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
  seed: 42
});
```

## API

### `limits(options?)`
Returns service limits.

### `run(request, options?)`
Runs inference on a graph. Throws `OversizeError` if payload exceeds 96 KB.

### `compare(options)`
Compares 2-5 graph options. Returns p10/p50/p90 + deltas + top_drivers.

### `inspect(options)`
Inspects graph evaluation details (beliefs, weights, provenance).

## Options

- `baseUrl`: API base URL (default: production)
- `scmLite`: Enable SCM-Lite mode
- `idempotencyKey`: Optional idempotency key (auto-generated if not provided)
- `requestId`: Optional request ID (auto-generated if not provided)

## Browser Support

The SDK is browser-safe:
- Uses `TextEncoder` for size calculation (with Node.js `Buffer` fallback)
- Sets `x-olumi-sdk` header for tracking
- Skips `User-Agent` in browsers (not allowed by CORS)
- Auto-generates request IDs using `crypto.randomUUID()`
- Auto-retries on 429 with `Retry-After` header

## Headers

All requests include:
- `x-olumi-sdk: olumi-plot-sdk/<version>` (always)
- `User-Agent: olumi-plot-sdk/<version>` (Node.js only)
- `X-Request-Id` (auto-generated or custom)
- `Idempotency-Key` (auto-generated for POST requests or custom)

## Rate Limiting

The SDK automatically retries once on 429 (Too Many Requests) using the `Retry-After` header value.
