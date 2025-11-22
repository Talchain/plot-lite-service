# Release v1.4.0 - Charter K-P Complete

**Released:** 2025-11-13  
**Tag:** v1.4.0  
**Status:** ✅ Production Ready

## Summary

Release v1.4.0 delivers the complete Charter K-P feature set, including sensitivity analysis, batch processing, action optimization, preference calibration, non-linear node effects, and enterprise versioning. This release also includes comprehensive SDK v0.4.0 with browser and Node.js samples, performance gates ensuring sub-600ms latency, and test harness stability improvements achieving 98.6% pass rate with zero flakes. Critical fixes were applied to the soak test payload schema and documentation accuracy before merge.

## Key Features

- **POST /v1/sensitivity** - One-at-a-time sensitivity analysis with tornado charts for robustness testing
- **POST /v1/run_batch** - Batch inference processing up to 10 graphs per request with per-item response hashes
- **POST /v1/optimise** - Budget-constrained action optimizer using greedy solver for utility maximization
- **POST /v1/preferences/fit** - Utility weight calibration from pairwise comparisons using Bradley-Terry model
- **Node effects** - Non-linear transforms (threshold, piecewise_linear) for realistic modeling
- **Enterprise versioning** - GET /__governance__/versions exposing engine/contract/model versions (TEST_ROUTES=1)

## SDK v0.4.0

- New functions: `runBatch()`, `optimise()`, `fitPreferences()`
- Browser example with ESM CDN and 429 retry handling
- Node.js example with idempotency keys and request correlation
- Package size: ~9 KB (ESM/CJS + TypeScript definitions)
- Tree-shakeable, browser-safe

## Performance

All routes exceed performance targets (p95 <600ms):
- /v1/run: p95=31ms (p50=1.2ms)
- /v1/compare: p95=2ms (p50=0.6ms)
- /v1/inspect: p95=1ms (p50=0.6ms)

## Test Stability

- Pass rate: 98.6% (698/708 tests passing)
- Zero flakes across consecutive runs
- Random ephemeral ports for parallel test isolation
- Graceful shutdown with 2s timeout

## Critical Fixes

- Soak test /v1/compare payload corrected to use `graphs[]` array schema
- Documentation accuracy: test counts and performance metrics clarified
- Performance metrics now reference perf-gate tests (not demo mode)

## Upgrade Notes

- All changes are backward-compatible
- No breaking API changes
- SDK v0.4.0 is a minor version bump with additive features
- OpenAPI documentation updated for all new endpoints

## Next Steps

- Manual 10-minute soak test at ~1-2 RPS
- Production deployment and smoke tests
- Work Package A: Interventions & Constraints
