# Test Results Summary - All P1C/P1D Branches

## P1C-2: SSE Stability Complete
- **Test Files**: 16 failed | 147 passed | 8 skipped (171)
- **Tests**: 21 failed | 499 passed | 13 skipped (533)
- **Duration**: 51.37s
- **Key Issue**: Critique array type mismatch (object instead of array)

## P1C-3A: Selfcheck Parity
- **Test Files**: 51 failed | 112 passed | 8 skipped (171)
- **Tests**: 28 failed | 445 passed | 60 skipped (533)
- **Errors**: 1 error (ABORT_ERR in stream.disconnect.test.ts)
- **Duration**: 136.50s

## P1C-3B: Trace ID
- **Test Files**: 53 failed | 110 passed | 8 skipped (171)
- **Tests**: 35 failed | 447 passed | 51 skipped (533)
- **Errors**: 1 error (ABORT_ERR in stream.disconnect.test.ts)
- **Duration**: 145.59s

## P1C-3C: Validation Envelope
- **Test Files**: 17 failed | 146 passed | 8 skipped (171)
- **Tests**: 27 failed | 493 passed | 13 skipped (533)
- **Errors**: 1 error (ABORT_ERR in stream.disconnect.test.ts)
- **Duration**: 50.79s

## P1C-3D: Critique Array
- **Test Files**: 28 failed | 135 passed | 8 skipped (171)
- **Tests**: 43 failed | 477 passed | 13 skipped (533)
- **Errors**: 1 error (rate-limit test error)
- **Duration**: 133.50s

## P1D-1: CI Gates
- **Test Files**: 33 failed | 130 passed | 8 skipped (171)
- **Tests**: 48 failed | 471 passed | 14 skipped (533)
- **Errors**: 2 errors (stream latency test errors)
- **Duration**: 125.20s

## Analysis

### Common Pattern: ABORT_ERR in stream.disconnect.test.ts
Multiple branches show abort errors in the disconnect test, suggesting a timing/cleanup issue in the test suite itself, not the features.

### Failure Counts
- Best: P1C-2 (21 failures) and P1C-3C (27 failures)
- Worst: P1D-1 (48 failures) and P1C-3D (43 failures)

### All branches have significant failures that need investigation before PR creation.
