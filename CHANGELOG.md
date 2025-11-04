# Changelog

All notable changes to plot-lite-service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-11-04

### Fixed
- **Version centralization**: Centralized service version in `src/version.ts` to prevent drift across version-reporting endpoints
- **Version alignment**: All public endpoints (`/version`, `/v1/version`, `/v1/health`) and metadata fields (`meta.version` in `/v1/run`, `/v1/self-check`) now return consistent version from single source of truth
- **Test robustness**: Tests now assert against shared `SERVICE_VERSION` constant instead of hardcoded strings, preventing breakage on version bumps

### Changed
- **Version reporting**: Added `version` field to root `/` endpoint alongside existing `api` protocol identifier (`warp/0.1.0`)
- **API protocol separation**: Clarified that `api: "warp/0.1.0"` is a protocol version, separate from service `version: "1.0.1"`

### Added
- **Version module**: Created `src/version.ts` exporting `SERVICE_VERSION` constant, sourced from `package.json` with env override support
- **Test helper**: Created `tests/helpers/version.ts` for shared version assertions in tests

### Confirmed
- **SSE parity maintained**: All SSE newline preservation (RFC 8895) and JSON↔SSE guard parity tests pass
- **No regressions**: 609 tests passing, identical to pre-refactor baseline

## [1.0.0] - 2025-11-03

### Added
- Initial release with SSE support, guard parity, and telemetry
