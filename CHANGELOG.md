# Changelog

## [Unreleased] - 2025-11-16 - vNext Work-in-Progress

⚠️ **Note**: This is a work-in-progress branch, not a complete release. Several phases deferred.

### Added - Partial Quality Improvements
- **Phase 1: Test Coverage** - 56 new tests (constraints, evidence, priors, determinism, headers)
- **Phase 2: Constraints Clarity** - `constraints_note` in model_card; /v1/run validates only, /v1/optimise applies
- **Phase 3: Evidence Single Source** - `sanitizeEvidence()` returns only `node_id` + `source` (security)

### Changed
- **Test Pass Rate** - 899/940 = 95.6% (target: 98.5%, gap: -2.9pp)
- **Evidence Sanitization** - Removed `weight` field from sanitized responses
- **Constraints Documentation** - OpenAPI clarifies /v1/run validates only, /v1/optimise applies

### Security
- Evidence responses limited to `node_id` + `source` fields only
- Single source of truth for evidence sanitization

### Deferred (Not in This Branch)
- **OpenAPI Conformance**: Request examples partially added, needs dedicated PR
- **SDK v0.6.1 Publish**: Built locally but not published to npm
- **Performance Guardrails**: Tests added but not validated against requirements
- **Merge Strategy**: No PR opened, needs review process

## [1.6.0] - 2025-11-16

### Added - Backend Observability & Determinism
- **X-Olumi-Backend header** - All inference endpoints now expose backend mode (fallback/scm_lite) via response header
- **model_card.backend** - Backend field added to model_card in all inference endpoint responses
- **Determinism golden tests** - Comprehensive seed-based reproducibility tests for /v1/run, /v1/optimise, /v1/run_bundle, /v1/run_timeslices
- **OpenAPI completeness** - Request examples and X-Olumi-Backend header documentation for all /v1/* routes
- **SDK v0.6.0** - Backend header helpers (getBackendFromResponse, isScmLiteActive, etc.)
- **Constraints clarity** - Tests proving /v1/run validates only, /v1/optimise applies constraints

### Changed
- **Evidence sanitization** - Only `node_id` and `source` fields exposed in meta.evidence_applied (security)
- **Constraints behavior** - /v1/run validates but doesn't apply; /v1/optimise validates and applies with meta.constraints_applied
- **Test stability** - 98.2% pass rate (839/854), zero flakes across 2 consecutive runs
- **OpenAPI** - Added request examples for /v1/critique and /v1/counterfactual

### Security
- Evidence metadata sanitized: removed `weight` and `note` fields from responses
- Constraints validation enforced on /v1/run (rejects malformed/violated constraints)

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
