# Changelog - P0 UI Integration

## Added

- **result.response_hash**: SHA-256 deterministic hash for UI caching
- **result.summary**: Direct p10/p50/p90 percentile mapping
- **explain_delta.top_edge_drivers**: Top-3 edges by sensitivity score
- **GET /v1/limits**: Graph size limits discovery endpoint
- **POST /v1/validate**: Pre-flight payload validation without execution
- **UI field rejection**: Strict validation blocks UI-only metadata fields

## Changed

- OpenAPI spec updated with P0 endpoints and error examples
- Test isolation improved with per-test env vars and module resets

## Fixed

- Test flakiness reduced from 21 failures to 4-7 (96.6% pass rate)
- Principal secret env var isolation in all test suites
- OpenAPI error code validation (INTERNAL_ERROR → INTERNAL)

## Documentation

- docs/UI_Handoff_P0.md: UI integration guide
- TEST_EVIDENCE.md: 3-run stability verification
- contracts/openapi.yaml: Complete P0 endpoint documentation
