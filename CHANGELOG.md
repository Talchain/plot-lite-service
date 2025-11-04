# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-11-04

### Added
- **SSE newline preservation (RFC 8895)**: Multi-line `data:` payloads now correctly joined with newlines before JSON parsing
- **SSE guard parity tests**: Comprehensive test suite verifying JSON↔SSE guard equivalence across caps, cost validation, and telemetry
- **Production documentation**: Added `docs/production-checklist.md` with deployment verification steps
- **Troubleshooting guide**: SSE multi-line data parsing guidance in `docs/assistants-proxy.md`

### Changed
- **SSE handler**: Refactored from string concatenation to array-based accumulation to preserve RFC 8895 newline semantics
- **Telemetry parity**: SSE `sse_complete` events now include `provider` and `cost_usd` fields with fallbacks matching JSON route behavior
- **Guard enforcement**: SSE route now buffers and validates `event: complete` payloads identically to JSON route (≤12 nodes, ≤24 edges, cost_usd validation)

### Fixed
- **SSE data corruption**: Previously, multiple `data:` lines were concatenated without newlines, corrupting multi-line JSON payloads
- **Telemetry gaps**: SSE telemetry missing provider/cost metadata when upstream omits fields
- **Guard drift**: SSE route was streaming upstream data without post-response validation

## [1.0.0] - 2025-11-04

### Added
- Initial release with Assistants proxy support
- JSON and SSE routes for `/assist/draft-graph`
- Provider support for OpenAI and Anthropic
- Cost tracking and caps enforcement
- Engine validation (non-blocking)
