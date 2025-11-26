# Changelog

## [Unreleased]

### Added - P1 Trust Signal Enhancements
- **detail_level** - `quick` | `standard` | `deep` controls compute budget and feature enablement
- **Adaptive K early-stopping** - Convergence detection stops sampling when p50 stabilizes (1% for standard, 0.5% for deep)
- **sensitivity_summary** - Concentration analysis (`high` | `medium` | `diffuse`) based on top driver impact
- **graph_quality** - Weighted score (0-1) combining completeness, evidence coverage, balance, identifiability
- **insights** - Human-readable summary, risks, and next_steps without user content leakage
- **linearity_warning** - Now exposed in `/v1/run` response (was computed but hidden)

### Fixed
- Linearity check now uses actual inference p50 (was using placeholder `baseline * 1.15`)
- Confidence k_coverage now uses actual K_evaluated (was using requested K)
- Evidence coverage excludes `template` provenance (only counts external evidence)
- sensitivity_summary concentration now calculated from all edges (was incorrectly using only top 3)

### Changed
- OpenAPI contract updated with P1 fields (`insights`, `graph_quality`, `sensitivity_summary`, `detail_level`)
- Contract snapshot regenerated for P1 fields

## [1.4.0] - 2025-11-13

### Added - Charter K-P Features
- **POST /v1/sensitivity** - One-at-a-time (OAT) sensitivity analysis with tornado charts
- **POST /v1/run_batch** - Batch processing (up to 10 items per request)
- **POST /v1/optimise** - Budget-constrained action optimizer with greedy solver
- **POST /v1/preferences/fit** - Utility weight calibration from pairwise comparisons
- **Node effects** - Non-linear transforms (threshold, piecewise_linear) on node schema
- **Enterprise versioning** - GET /__governance__/versions (TEST_ROUTES=1) with version stamps
- **SDK v0.4.0** - Added runBatch(), optimise(), fitPreferences() functions
- **SDK samples** - Browser (ESM CDN) and Node.js examples with idempotency
- **Performance gates** - Automated p95 latency checks for run/compare/inspect
- **Test stability** - Random ephemeral ports, graceful shutdown, zero flakes

### Changed
- Test harness: Parallel execution (maxThreads: 4), increased timeouts
- SDK package size: ~9 KB (ESM/CJS + .d.ts)
- Test pass rate: 98.7% (696/705 passing)

### Performance (perf-gate tests, 10 runs each)
- /v1/run: p95=31ms (p50=1.2ms)
- /v1/compare: p95=2ms (p50=0.6ms)
- /v1/inspect: p95=1ms (p50=0.6ms)
- All well under 600ms target

## [1.3.0] - 2025-11-12

### Added
- **POST /v1/compare** - Compare 2-5 graph options with p10/p50/p90 + deltas + top_drivers
- **POST /v1/inspect** - Introspect graph evaluation (beliefs, weights, provenance)
- **SDK v0.2.0** - Added `compare()` and `inspect()` functions
- **Auto request ID generation** - SDK automatically generates X-Request-Id using crypto.randomUUID
- **Auto idempotency keys** - SDK automatically generates Idempotency-Key for POST requests
- **429 auto-retry** - SDK automatically retries once on 429 using Retry-After header
- **Performance gate CI** - Workflow to check p95 latency (warns if > 600ms)
- **OpenAPI documentation** - Added compare.v1 and inspect.v1 schemas with examples

### Changed
- SDK version bumped from 0.1.1 to 0.2.0
- Package size: ESM 1.7KB, CJS 2.7KB

## [1.2.0] - 2025-11-11

### Added
- **X-Request-Id support** - Echo back if provided, generate UUID if missing
- **Enhanced /v1/limits** - Added rate_limit_rpm and flags.scm_lite fields
- **Structured logs** - 429 and 413 errors now logged with context
- **TypeScript SDK v0.1.1** - Browser-safe client with TextEncoder support

### Changed
- Request ID generation uses crypto.randomUUID() instead of empty string
- Startup logs include CORS allowlist and effective RPM
