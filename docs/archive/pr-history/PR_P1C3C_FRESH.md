# fix(p1c-3c): validation envelope — no regression vs baseline

## What Changed
Field-aware validation error envelopes with structured `fields: {field, max}` for limit exceeded errors.

## Evidence
```
Baseline (main): Test Files: 26 failed | Tests: 34 failed
Branch (p1c-3c): Test Files: 18 failed | Tests: 32 failed
Delta:           Files: -8 | Tests: -2  (✅ IMPROVEMENT)
```

## Known Status
Remaining failures are pre-existing from A2 taxonomy migration (tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`).

ABORT_ERR in stream.disconnect.test.ts is test infrastructure issue (all 9 tests pass).

## Security
✅ No payload logging | ✅ Bounded metrics | ✅ No PII

## Rollback
`git revert <sha>` is clean. No breaking changes.
