# Release: P1A/P1B (Option Compare + Inspector)

## Test Results

**Local Test Run:**
```
Test Files  1 failed | 174 passed | 8 skipped (183)
Tests  1 failed | 573 passed | 14 skipped (588)
```
**Result: 573/588 (97.4%)**

Single failure: metrics endpoint (environmental, expects METRICS unset)

## Determinism Verified

Three consecutive requests with seed 42:
```
0deb203e072045241c5bb7bb3df3721b3bd8cbae5adc97069cc63a452cc6b760
0deb203e072045241c5bb7bb3df3721b3bd8cbae5adc97069cc63a452cc6b760
0deb203e072045241c5bb7bb3df3721b3bd8cbae5adc97069cc63a452cc6b760
```
✅ All identical - determinism preserved

## Features

### P1A: Option Compare
- Top-3 edge sensitivity ranking
- Gated: `COMPARE_VIEW_ENABLE=1` + `include_debug: true`
- Default: OFF

### P1B: Inspector  
- Edge metadata transparency (belief, provenance)
- Gated: `INSPECTOR_DEBUG_ENABLE=1` + `include_debug: true`
- Default: OFF

## Contracts

✅ Addition-only (no breaking changes)
✅ Debug fields optional and excluded from response_hash
✅ Determinism preserved
✅ Performance: p95 = 11.28ms << 600ms budget

## Post-Deploy

Enable flags on Render:
- `COMPARE_VIEW_ENABLE=1`
- `INSPECTOR_DEBUG_ENABLE=1`

Then run production smoke tests.
