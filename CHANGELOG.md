# Changelog

## [1.3.0] - 2025-11-12

### Added
- **POST /v1/compare** - Compare 2-5 graph options with p10/p50/p90 + deltas + top_drivers
- **POST /v1/inspect** - Introspect graph evaluation (beliefs, weights, provenance)
- **SDK v0.2.0** - Added `compare()` and `inspect()` functions
- **Auto request ID generation** - SDK automatically generates X-Request-Id using crypto.randomUUID
- **Auto idempotency keys** - SDK automatically generates Idempotency-Key for POST requests
- **429 auto-retry** - SDK automatically retries once on 429 using Retry-After header
- **Performance gate CI** - Workflow to check p95 latency (warns if > 600ms)

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
