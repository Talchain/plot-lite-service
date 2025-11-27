# CRITICAL RETRACTION: v1.7.0 Claims Invalid

**Date**: 2025-11-15  
**Severity**: 🔴 BLOCKING  
**Status**: v1.7.0 NOT READY FOR RELEASE

---

## Executive Summary

v1.7.0 release claims are **FALSE**. Priors are still validation-only despite documentation claiming they are functional. Tests that were claimed to pass never actually ran. Quality bar (98.5%) was not met.

**Action Required**: Retract v1.7.0 tag, fix implementation, write real tests, meet quality bar.

---

## Critical Findings

### 1. Priors Still Don't Work 🔴

**Claim**: "Functional priors - priors now influence inference results"

**Reality**: Priors are still validation-only

**Root Cause**:
- `SCM_LITE_ENABLE` is disabled by default (`.env.example`)
- When disabled, `model_based.ts` uses fallback simulation (lines 45-53)
- Fallback simulation **ignores priors entirely**:

```typescript
// Fallback: placeholder simulation
// In production, this should log a warning (handled by caller)
const current_value = baseline_value * 1.15; // Simple placeholder

return {
  conservative: { outcome: baseline_value * 1.05 },
  most_likely: { outcome: current_value },
  optimistic: { outcome: baseline_value * 1.25 },
};
```

**Evidence**:
- No reference to `priors` or `workingGraph` in fallback path
- Results are purely based on `baseline_value`
- `applyPriorsToGraph` is called but its output is never used in fallback

**Impact**: Users get identical results with or without priors (unless SCM_LITE is enabled, which it isn't by default)

---

### 2. Tests Never Ran 🔴

**Claim**: "5 golden fixture tests passing"

**Reality**: All 5 tests failed with server startup errors

**Evidence**:
```
FAIL  tests/priors-functional.test.ts > priors influence results (number format)
TypeError: Failed to parse URL from undefined/v1/run
```

**Root Cause**:
- `baseUrl` is undefined
- Server never started in test environment
- Tests failed before making any assertions

**Impact**: Zero actual verification that priors work

---

### 3. No Regression Tests 🔴

**Claim**: "Golden fixtures verify priors influence results"

**Reality**: Even if tests ran, they don't verify priors change outputs

**Analysis of Test**:
```typescript
// Test DOES compare with/without priors (line 71)
expect(Math.abs(withP50 - withoutP50)).toBeGreaterThan(0.01);
```

**But**: This test would FAIL if it ran, because:
1. SCM_LITE disabled → fallback simulation used
2. Fallback ignores priors
3. Both requests return identical results
4. `Math.abs(withP50 - withoutP50)` would be 0, not > 0.01

**Impact**: If tests had run, they would have caught this bug

---

### 4. Quality Bar Not Met 🔴

**Claim**: "≥98.5% pass rate achieved"

**Reality**: 96.7% pass rate (789/816)

**Gap**: 15 tests short of target (need 804/816)

**Acceptance Document Says**:
```
ACCEPT:STABILITY pass_rate>=98.5% flakes=0 runs=2
```

**But Then Says**:
```
Status: ⚠️ PRAGMATIC ACCEPTANCE (96.7% achieved, target 98.5%)
```

**Impact**: Misrepresenting quality metrics

---

### 5. False Documentation 🔴

**README.md** claims:
```markdown
## ✨ New in v1.7.0

- **Functional Priors** - Priors now influence inference results
```

**RELEASE_NOTES_v1.7.0.md** claims:
```markdown
### 1. Functional Priors ✅

**Status**: Priors now influence inference results!
```

**Reality**: Priors are still validation-only (same as v1.6.0)

**Impact**: Breaking trust with users who expect functional priors

---

## What Actually Works

### ✅ Code Structure
- `InferenceConfig` type extended with priors ✅
- `applyPriorsToGraph` utility created ✅
- Priors wired to `/v1/run` endpoint ✅
- Validation works ✅

### ❌ Functionality
- Priors don't influence results (SCM_LITE disabled) ❌
- Fallback simulation ignores priors ❌
- No regression tests ❌
- Quality bar not met ❌

---

## Root Causes

### 1. SCM_LITE Disabled by Default
- Fallback simulation is a placeholder
- Never intended to support priors
- Should either:
  - Enable SCM_LITE by default, OR
  - Implement priors in fallback simulation

### 2. Tests Never Verified
- Server startup issues in test environment
- Tests failed before assertions
- False positive: assumed passing because no error was caught

### 3. Insufficient Verification
- No manual testing
- No smoke tests
- No verification that priors actually change results

---

## Required Fixes

### BLOCKING (Must fix before v1.7.0)

1. **Fix Priors Implementation**
   - Option A: Enable SCM_LITE by default
   - Option B: Implement priors in fallback simulation
   - Option C: Return error if priors used without SCM_LITE

2. **Fix Tests**
   - Fix server startup in test environment
   - Verify tests actually run
   - Verify tests actually compare with/without priors

3. **Add Regression Tests**
   - Test that priors change results
   - Test determinism (same priors + seed = same results)
   - Test validation (invalid priors rejected)

4. **Meet Quality Bar**
   - Fix 15 failing tests to reach 98.5%
   - OR document exception with justification
   - OR lower quality bar (with approval)

5. **Fix Documentation**
   - Remove "functional priors" claims
   - Document actual status (validation-only unless SCM_LITE enabled)
   - Update release notes
   - Update README

---

## Recommended Actions

### Immediate (Today)

1. **Retract v1.7.0 Tag**
   ```bash
   git tag -d v1.7.0
   git push origin :refs/tags/v1.7.0  # If pushed
   ```

2. **Create Honest Status Document**
   - Document what actually works
   - Document what doesn't work
   - Document required fixes

3. **Fix Implementation**
   - Choose Option A, B, or C above
   - Implement fix
   - Test manually

4. **Fix Tests**
   - Debug server startup
   - Run tests successfully
   - Verify priors change results

### Short-term (This Week)

5. **Meet Quality Bar**
   - Fix failing tests OR
   - Document exception

6. **Update Documentation**
   - Accurate status
   - No false claims

7. **Re-release v1.7.0**
   - Only when priors actually work
   - Only when tests pass
   - Only when quality bar met

---

## Honest Assessment

### What We Claimed
- ✅ v1.7.0 with functional priors
- ✅ 5 golden tests passing
- ✅ 98.5% pass rate
- ✅ Production-ready

### What We Have
- ❌ Priors still validation-only
- ❌ Tests never ran (server startup failed)
- ❌ 96.7% pass rate (15 tests short)
- ❌ Not production-ready

### Trust Impact
- **High Risk**: Shipping v1.7.0 with false claims breaks user trust
- **SDK Impact**: Users expect priors to work, they don't
- **Documentation Impact**: Release notes claim functionality that doesn't exist

---

## Decision

**DO NOT SHIP v1.7.0** until:
1. Priors actually work
2. Tests actually run and pass
3. Quality bar actually met
4. Documentation actually accurate

**Alternative**: Ship v1.6.0 only, document priors as "planned for v1.7.0"

---

## Acceptance Criteria (Real)

### Before v1.7.0 Can Ship
- [ ] Priors influence inference results (verified manually)
- [ ] Tests run successfully (no server startup errors)
- [ ] Tests verify priors change results (regression tests)
- [ ] Pass rate ≥98.5% OR documented exception
- [ ] Documentation accurate (no false claims)
- [ ] Manual smoke test: same graph + priors → different results

---

## Lessons Learned

1. **Always verify tests actually run** - Don't assume passing
2. **Manual testing required** - Automated tests aren't enough
3. **Regression tests must verify behavior** - Not just status codes
4. **Quality bars are hard requirements** - Not suggestions
5. **Documentation must match reality** - No aspirational claims

---

**Status**: 🔴 v1.7.0 BLOCKED - Do not ship until fixes complete

**Recommendation**: Retract v1.7.0, fix implementation, re-release when actually ready
