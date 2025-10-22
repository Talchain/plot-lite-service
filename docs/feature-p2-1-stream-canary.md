# P2-1: Stream Canary Header

**Status**: Implemented  
**Version**: v1.0  
**Date**: 2025-01-21

## Overview

Adds support for a canary header to enable enhanced streaming features on `/v1/stream` while maintaining backward compatibility with legacy headers. Includes telemetry to track adoption and deprecation.

## Accepted Headers

### Canonical Header (Preferred)
- **Name**: `X-Enable-Enhanced-Stream`
- **Values**: Truthy values accepted (case-insensitive)
  - `1`, `true`, `yes`, `on`
  - Case variations: `True`, `TRUE`, `Yes`, `YES`, etc.

### Legacy Header (Deprecated)
- **Name**: `X-Stream-Enhanced`
- **Values**: Same truthy parsing as canonical
- **Deprecation**: Tracked via `plot_engine_stream_deprecated_header_total` counter

## Implementation

### Header Parsing
```typescript
function isEnhancedStream(req: FastifyRequest): boolean {
  const canonical = req.headers['x-enable-enhanced-stream'];
  const legacy = req.headers['x-stream-enhanced'];
  
  // Prefer canonical
  if (canonical) {
    return isTruthy(canonical);
  }
  
  // Fall back to legacy (increment deprecation counter)
  if (legacy) {
    incDeprecatedHeaderUsage();
    return isTruthy(legacy);
  }
  
  return false;
}

function isTruthy(val: string | string[] | undefined): boolean {
  const s = String(val || '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
```

### Route Gating
- **Scope**: Only `/v1/stream` route checks these headers
- **Behavior**: When enabled, activates enhanced streaming features (heartbeats, resume support, etc.)
- **Default**: Enhanced features OFF unless header present

## Metrics

### Canary Header Usage
```promql
# Counter: Requests with canonical header
plot_engine_stream_canary_total{route="/v1/stream"}

# Example output:
plot_engine_stream_canary_total{route="/v1/stream"} 42
```

### Deprecated Header Usage
```promql
# Counter: Requests with legacy header
plot_engine_stream_deprecated_header_total{route="/v1/stream"}

# Example output:
plot_engine_stream_deprecated_header_total{route="/v1/stream"} 7
```

### Label Conventions
- **Closed-set labels**: Only `route` label, always `/v1/stream`
- **Cardinality**: O(1) - single route
- **Aggregation**: Sum across instances for total adoption

## Test Plan

### Unit Tests
```bash
npm test -- tests/p2-1-canary.test.ts
```

**Coverage**:
- ✅ Canonical header parsing (various truthy values)
- ✅ Legacy header parsing (with deprecation counter)
- ✅ Case-insensitive matching
- ✅ Header precedence (canonical > legacy)
- ✅ Metrics incrementation

### E2E Tests
```bash
# Test canonical header
curl -H "X-Enable-Enhanced-Stream: 1" http://localhost:3490/v1/stream

# Test legacy header (should work but increment deprecation counter)
curl -H "X-Stream-Enhanced: true" http://localhost:3490/v1/stream

# Verify metrics
curl -s http://localhost:3490/metrics | grep plot_engine_stream
```

### Prometheus Scrape Proof
```bash
# Start server
PORT=3490 node dist/main.js &

# Make requests with headers
for i in {1..5}; do
  curl -sS -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3490/v1/stream?demo=1" > /dev/null
done

for i in {1..2}; do
  curl -sS -H "X-Stream-Enhanced: yes" "http://localhost:3490/v1/stream?demo=1" > /dev/null
done

# Check metrics
curl -s http://localhost:3490/metrics | grep -E "plot_engine_stream_(canary|deprecated)"
# Expected:
# plot_engine_stream_canary_total{route="/v1/stream"} 5
# plot_engine_stream_deprecated_header_total{route="/v1/stream"} 2
```

## Migration Guide

### For Clients Using Legacy Header
```diff
- headers: { 'X-Stream-Enhanced': '1' }
+ headers: { 'X-Enable-Enhanced-Stream': '1' }
```

### Deprecation Timeline
1. **Phase 1** (Current): Both headers supported, legacy tracked
2. **Phase 2** (Q2 2025): Warnings logged for legacy header usage
3. **Phase 3** (Q3 2025): Legacy header support removed

## Security & Performance

### Security
- **Input validation**: Truthy parsing prevents injection
- **No PII**: Headers not logged in full, only counters incremented
- **Rate limiting**: Applied before header check

### Performance
- **Overhead**: O(1) header lookup, negligible (<1ms)
- **Memory**: Counters only, no per-request state
- **Cardinality**: Closed-set labels prevent metric explosion

## Rollback Plan

If issues arise:
```bash
# Disable enhanced features via env var
FEATURE_STREAM_ENHANCED=0 node dist/main.js

# Or revert the commit
git revert <p2-1-commit-sha>
```

## References

- **PR**: #TBD
- **Tests**: `tests/p2-1-canary.test.ts`
- **Metrics**: `src/observability/streamMetrics.ts`
- **Route**: `src/routes/v1/stream.ts`, `src/routes/v1/stream-enhanced.ts`

## Changelog

### v1.0 (2025-01-21)
- Initial implementation
- Canonical header: `X-Enable-Enhanced-Stream`
- Legacy header: `X-Stream-Enhanced` (deprecated)
- Metrics: canary + deprecated counters
- Tests: unit + e2e coverage
