# Status: 98.5% Pass Rate Blockers

**Date**: 2025-11-15 14:30 UTC  
**Current**: 794/817 = 97.2%  
**Target**: 804/817 = 98.5%  
**Gap**: 10 tests

---

## Completed Fixes (1/7)

✅ **Report Contract Snapshot** - FIXED
- Updated snapshot with correct environment flags
- Test now passing (2/2)
- Commit: 7edd210

---

## Remaining Failures (6/7)

### 1. OpenAPI Error Examples Test (1 failure)

**File**: `tests/openapi.examples.test.ts`

**Issue**: 11 routes missing error examples in OpenAPI spec

**Routes with examples** (12):
- /v1/counterfactual, /v1/critique, /v1/draft, /v1/health
- /v1/intervene, /v1/limits, /v1/openapi.json, /v1/optimise
- /v1/run, /v1/run_bundle, /v1/run_timeslices, /v1/sensitivity
- /v1/stream, /v1/templates, /v1/templates/{id}/graph
- /v1/validate, /v1/version

**Routes missing examples** (11):
- /v1/compare, /v1/evidence, /v1/inspect
- /v1/preferences/fit, /v1/run_batch, /v1/score

**Fix Required**: Add error examples to `contracts/openapi.yaml` for each missing route

**Estimated Time**: 30-45 minutes (3-4 min per route)

---

### 2. Optimise OpenAPI Tests (2 failures)

**File**: `tests/optimise-openapi.test.ts`

**Issue**: Missing request body example in OpenAPI spec

**Error**:
```
expected undefined to be defined
const exampleRequest = openapi.paths['/v1/optimise'].post.requestBody.content['application/json'].examples.basic
```

**Fix Required**: Add `examples.basic` to `/v1/optimise` POST request body in `contracts/openapi.yaml`

**Estimated Time**: 10 minutes

---

### 3. Run Bundle OpenAPI Tests (2 failures)

**File**: `tests/run-bundle-openapi.test.ts`

**Issue**: Missing request body example in OpenAPI spec

**Error**:
```
Cannot read properties of undefined (reading 'basic')
const exampleRequest = openapi.paths['/v1/run_bundle'].post.requestBody.content['application/json'].examples.basic
```

**Fix Required**: Add `examples.basic` to `/v1/run_bundle` POST request body in `contracts/openapi.yaml`

**Estimated Time**: 10 minutes

---

### 4. Rate Limit Conformance Test (1 failure)

**File**: `tests/rate-limit.conformance.test.ts`

**Test**: "does not log payloads or query strings"

**Issue**: Payloads are being logged when they shouldn't be

**Error**:
```
expected true to be false
// Checking if payload was logged
```

**Fix Required**: Find where payloads are being logged and disable

**Estimated Time**: 15-20 minutes

---

## Total Estimated Time to Fix All 6

- OpenAPI error examples: 30-45 min
- Optimise example: 10 min
- Run bundle example: 10 min
- Rate limit logging: 15-20 min

**Total**: 65-85 minutes (1-1.5 hours)

---

## Alternative Approach

### Option 1: Fix All 6 (Recommended for v1.7.0)
- Reach 98.5% pass rate
- Meet all acceptance criteria
- Ship v1.7.0 properly
- **Time**: 1-1.5 hours

### Option 2: Fix Quick Wins Only
- Fix optimise + run_bundle + rate-limit (3 tests)
- Gets us to 797/817 = 97.5%
- Still short of 98.5%
- **Time**: 30-40 minutes

### Option 3: Ship at 97.2%
- Accept current pass rate
- Document as known limitation
- Address in v1.7.1
- **Time**: 0 minutes

---

## Recommendation

**Option 1** - Fix all 6 remaining failures

**Rationale**:
- We're very close (10 tests away)
- Priors are working (main goal achieved)
- 1-1.5 hours is reasonable
- Better to meet quality bar
- OpenAPI spec should be complete anyway

**Alternative**: If time-constrained, do Option 2 (quick wins) to get to 97.5%, then address OpenAPI examples in v1.7.1

---

## Progress So Far

### ✅ Completed (Steps 1-3)
1. Priors functional in fallback simulation
2. Test environment fixed
3. Regression tests added (6 tests, all passing)
4. Report contract snapshot updated

### 🟡 In Progress (Step 4)
- Pass rate: 97.2% (794/817)
- Fixed: 1/7 non-quarantined failures
- Remaining: 6/7 failures

### ⏸️ Pending (Steps 5-6)
5. Manual verification and documentation
6. Tag v1.7.0

---

## Key Achievement

**Priors are functional and tested** ✅

Without priors: p50=100  
With priors (demand=0.8): p50=108.4  
Difference: 8.4 (8.4% increase)

The core feature works. The remaining work is test infrastructure (OpenAPI examples) and quality bar (98.5%).

---

**Decision Point**: Continue to 98.5% (1-1.5 hours) or ship at 97.2%?
