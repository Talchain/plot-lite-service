# Changelog

## [1.1.1] - 2025-11-10

### Fixed
- Deterministic token-bucket admission (RPM=1 edge case resolved)
- Instance-scoped rate-limit store (no cross-instance bleed)
- Unified bypass predicate (health/metrics/limits/SSE)
- Per-request SCM-Lite gating (header → query → env)

### Operations
- Expect RATE_LIMIT_ENABLED=1 in production
- Expect PROD_SCM_LITE_PLACEHOLDER=0 in production
- Safe test signal (serial): ≥98.5% pass; remaining flakes are test-infrastructure only

## [1.2.0] - 2025-11-09

### Fixed
- **Rate Limit**: Corrected replay admission logic to use `>=` check for count, preventing false 429s at RPM=1
- **Rate Limit**: Fixed pending calculation to only increment for non-replay requests
- **Rate Limit**: Instance-scoped store prevents cross-test state bleed
- **Rate Limit**: Moved commit hook from `onSend` to `onResponse` for stable lifecycle
- **Rate Limit**: Unified bypass predicate (`shouldBypass`) eliminates drift between checks
- **Rate Limit**: POST/PUT/PATCH admission moved to `preHandler` ensuring 400 beats 429
- **SCM-Lite**: Per-request gating with header → query → env precedence
- **SCM-Lite**: Placeholder mode returns correct shape (no `bma_hash`) in production
- **Metrics**: Health counters (`json_429_count`, `sse_429_count`) via helper functions

### Added
- Smoke test script (`scripts/smoke.sh`) for staging readiness verification
- Comprehensive rate limit conformance tests
- SSE soak test for stability verification

### Changed
- Rate limiter now uses Fastify instance decoration for store isolation
- All methods processed in `preHandler` for consistent validation precedence
- Headers (`X-RateLimit-*`) guaranteed on all responses, 429s include `Retry-After`

## [1.0.0] - 2025-10-16

Initial release with PLoT Engine core functionality.
