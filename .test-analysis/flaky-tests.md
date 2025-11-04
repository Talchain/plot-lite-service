# Flaky Test Analysis

## Consistently Failing (All 3 Runs)

1. **tests/health.counters.test.ts** - Health counters test
2. **tests/inspector.test.ts** - Inspector debug fields (2-3 tests)
3. **tests/openapi.examples.test.ts** - OpenAPI error examples
4. **tests/run.scm-lite.integration.test.ts** - SCM-Lite integration (3-4 tests)

## Intermittently Failing (1-2 Runs)

5. **tests/option-compare.test.ts** - Option Compare debug fields (2 tests)
6. **tests/metrics.shape.test.ts** - Metrics endpoint (1 run)
7. **tests/scm-lite.disabled-warning.test.ts** - SCM-Lite disabled (1 run)

## Pattern Analysis

**Debug Field Tests (inspector, option-compare):**
- Expect `debug.inspector` or `debug.compare` fields
- Fields are undefined
- Likely env var issue: `INSPECTOR_DEBUG_ENABLE`, `COMPARE_VIEW_ENABLE`

**Server Startup Tests (health, scm-lite, metrics):**
- "fetch failed" errors
- Server not starting properly
- Port conflicts or cleanup issues

**Contract Tests (openapi, scm-lite):**
- Schema validation failures
- Test data or route registration issues

## Priority Order

1. Fix server startup/cleanup (affects 5+ tests)
2. Fix debug field env vars (affects 4+ tests)
3. Fix contract validation (affects 2+ tests)
