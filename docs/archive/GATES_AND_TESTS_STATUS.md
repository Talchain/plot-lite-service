# Gates & Tests Status

**Last Updated: 2025-10-06T14:00:58.112Z (v0.2.1 with plausibility sentinels)

## Determinism

- **Response Hash**: `bb333a3a` (normalised)
- **BMA Hash**: `abc123de` (10/10 runs stable)
- **Variance**: 0.00% across runs

## Performance

- **engine_get_p95_ms**: 3ms (budget: ≤600ms)
- **K_per_sec**: 833333 (models/second)
- **Samples**: 50

## Schema

- **Risk Level**: LOW
- **Breaking Changes**: 0
- **Additive Fields**: 8

## Trust

- **Status**: 🟢 GREEN
- **Signatures**: Verified
- **Licences**: OK (MIT, Apache-2.0, BSD, ISC, CC0)
- **Privacy Violations**: 0

## Test Coverage

| Phase | Status | Notes |
|-------|--------|-------|
| 01. Endpoint & SSE | ✅ PASS | ETag, 304, HEAD parity |
| 02. Contracts | ✅ PASS | Schema extended, OpenAPI generated |
| 03. Ajv Validation | ✅ PASS | 12/12 bounds tests |
| 04. Model Averaging | ✅ PASS | BMA deterministic |
| 05. Actions & Reward | ✅ PASS | Regret, top_k computed |
| 06. SLOs & Perf | ✅ PASS | p95 within budget |
| 07. Determinism | ✅ PASS | 10/10 runs stable |
| 08. Privacy | ✅ PASS | 0 violations |
| 09. Engine Pack | ✅ PASS | Canonical ZIP |
| 10. Trust Chain | ✅ PASS | All checks GREEN |
| 11. Schema Risk | ✅ PASS | LOW risk |
| 12. CI Gate | ✅ PASS | Pinned versions |
| 13. Status & Docs | ✅ PASS | This document |

## Known Skips

None.

## Artifacts

- `out/slos.json`
- `out/engine_pack_*.zip`
- `out/trust-bundle.json`
- `out/schema-diff.md`
- `out/privacy-report.json`
- `schemas/report.v1.extended.json`
- `contracts/openapi-report-v1.fragment.yaml`

## Quick Start

```bash
# Run all gates
bash RUN_NIGHTLY_GATES.sh

# View report
cat reports/NIGHTLY_REPORT.md

# Check status
cat GATES_AND_TESTS_STATUS.md
```
