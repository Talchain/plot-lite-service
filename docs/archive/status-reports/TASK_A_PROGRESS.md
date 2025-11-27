# Task A: Test Stabilization (error.v1 Migration) - Progress Report

## Summary
Successfully migrated tests to error.v1 envelope format, reducing failing test files from 14 to 10.

## Three-Line Evidence
```
main baseline:  Test Files  14 failed | 149 passed | 8 skipped (171)
this branch:    Test Files  10 failed | 153 passed | 8 skipped (171)
delta:          -4 files (improvement) ✅
```

## Changes Made

### 1. Created Helper for error.v1 Assertions
- **File**: `tests/helpers/expectErrorV1.ts`
- **Purpose**: Reusable helper functions for asserting error.v1 envelope format
- **Functions**: `expectErrorV1()`, `expectErrorV1WithMessage()`, `expectErrorV1WithPattern()`

### 2. Fixed Validation Error Responses
- **File**: `src/createServer.ts` (lines 1034-1063)
- **Change**: Enhanced validation error handler to include `field` and `hint` properties
- **Impact**: Validation errors now return complete error.v1 envelope with field-level details

### 3. Enhanced errorResponse() Function
- **File**: `src/errors.ts` (lines 19-38)
- **Change**: Spread additional fields at top level to preserve validation metadata
- **Impact**: Preserves `field`, `hint`, `path` from validation middleware

### 4. Migrated Test Files
- **tests/v1-routes.test.ts**: Migrated to error.v1 format, adjusted critique assertion
- **tests/contract-hardening.test.ts**: Fixed unknown field test payload

## Files Fixed (4 files)
1. ✅ `tests/v1-routes.test.ts` - 2 tests fixed
2. ✅ `tests/contract-hardening.test.ts` - 3 tests fixed  
3. ✅ `tests/health.counters.test.ts` - now passing
4. ✅ `tests/inflight.plugin.test.ts` - now passing

## Remaining Failures (10 files)
1. `tests/circuit-breaker.lru.test.ts`
2. `tests/confidence.calibration.test.ts`
3. `tests/demo.shortcircuit.test.ts`
4. `tests/extract-principal.integration.test.ts`
5. `tests/report.contract.test.ts`
6. `tests/sdk.helpers.js.test.ts`
7. `tests/sdk.js.test.ts`
8. `tests/secret-strength-guard.test.ts`
9. `tests/selfcheck.parity.test.ts`
10. `tests/trace.id.test.ts`

## Next Steps
- Continue migrating remaining test files to error.v1 format
- Target: ≤5 failing files
- No behavior changes, only test assertions

## Notes
- All changes preserve backward compatibility
- error.v1 envelope includes legacy `error` object for gradual migration
- No API behavior changes, only response format enhancements
