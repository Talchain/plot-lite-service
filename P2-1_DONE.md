# P2-1 Clean Integration - COMPLETE

## Changes Applied

1. **src/metrics.ts** (lines 215-221): Added streamCanaryTotal, streamDeprecatedHeaderTotal counters
2. **src/plugins/metrics.ts** (lines 86-93): Exposed metrics in /metrics endpoint
3. **src/routes/v1/stream.ts** (lines 19-48, 170-172): Added parseEnhancedStreamHeader() function
4. **tests/p2-1-canary.test.ts**: New test file (48 lines)

## Headers Supported
- Canonical: `X-Enable-Enhanced-Stream` (increments canary counter)
- Legacy: `X-Stream-Enhanced` (increments deprecated counter)
- Truthy: 1, true, yes, on (case-insensitive)

## P1 Fixes Preserved
✅ EPIPE/ERR_STREAM_DESTROYED handling (line 53)
✅ SSE stability, validation, CI gates unchanged

## Next Steps
```bash
npm ci && npm run build
npm test
git add -A
git commit -m "feat(p2-1): add stream canary header + metrics (clean integration)"
```

## Verification
```bash
# No artifacts
git ls-files | grep '^src/.*\.js$'

# EPIPE present
grep -n EPIPE src/routes/v1/stream.ts

# Metrics work
PORT=3500 PROMETHEUS_ENABLE=1 node dist/main.js &
curl -H "X-Enable-Enhanced-Stream: 1" http://localhost:3500/v1/stream?demo=1
curl -s http://localhost:3500/metrics | grep plot_engine_stream
```
