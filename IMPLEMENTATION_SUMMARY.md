# Implementation Summary

## Phase 1: P2-1 ✅ COMPLETE
- src/metrics.ts: Canary counters added (lines 215-221)
- src/plugins/metrics.ts: Metrics exposed (lines 86-93)
- src/routes/v1/stream.ts: Header parser (lines 19-48, 170-172)
- tests/p2-1-canary.test.ts: 4 tests

**Ready to commit**: `git checkout -b feat/p2-1-clean-integration`

## Phase 2: A2 Error Taxonomy ✅ COMPLETE
- src/errors.ts: Updated ErrorType, added helpers
- Need: tests/a2-error-taxonomy.test.ts

**Next**: Create test file, then commit

## Phase 3-8: TODO
- A3: Rate-limit (fix middleware order)
- D1: Determinism (JCS + meta fields)
- L1: /v1/limits endpoint
- T1: Templates registry
- S1: SSE hardening
- O1: OpenAPI schemas

## Commands
```bash
# P2-1
git checkout -b feat/p2-1-clean-integration
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts
git commit -m "feat(p2-1): add stream canary header + metrics"

# A2
git checkout -b feat/a2-error-taxonomy
git add src/errors.ts tests/a2-error-taxonomy.test.ts
git commit -m "feat(a2): closed-set error taxonomy"
```
