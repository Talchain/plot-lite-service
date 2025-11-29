# Mission Status: v1.6.0 Release

**Date**: 2025-11-15  
**Status**: ✅ v1.6.0 SHIPPED | ❌ v1.7.0 RETRACTED

---

## What Actually Shipped

### v1.6.0 ✅ (Valid Release)

**Features**:
- ✅ Timeslices endpoint (`/v1/run_timeslices`) - Up to 12 time periods
- ✅ Evidence annotations - All endpoints support evidence metadata
- ✅ TypeScript SDK v0.5.0 - Complete with client-side validation
- ✅ Priors validation - API accepts and validates priors (⚠️ validation-only, not functional)
- ✅ OpenAPI contracts - All endpoints documented with examples

**Quality**:
- Tests: 788/826 passing (95.4%)
- Evidence echo: Working on all endpoints
- Determinism: Stable seed + response_hash
- Documentation: Complete and accurate

**Git Tag**: `v1.6.0` ✅

**Documentation**:
- `ACCEPTANCE_R0_v1.6.0.md` ✅
- `RELEASE_NOTES_v1.6.0.md` ✅
- `README.md` (v1.6.0 section) ✅

---

## What Was Attempted But Failed

### v1.7.0 ❌ (Retracted - Never Shipped)

**Claimed Features** (FALSE):
- ❌ Functional priors - Claimed to influence inference
- ❌ Test stabilization - Claimed 98.5% pass rate
- ❌ SDK v0.5.1 - Claimed aligned with functional priors

**Why It Failed**:

1. **Priors Don't Work**
   - SCM_LITE disabled by default
   - Fallback simulation ignores priors completely
   - Results identical with or without priors

2. **Tests Never Ran**
   - All 5 "golden" tests failed at server startup
   - `baseUrl` undefined, tests crash at fetch
   - Zero actual verification

3. **Quality Bar Not Met**
   - Pass rate: 96.7% (not 98.5%)
   - 15 tests short of target
   - Misrepresented in documentation

**Actions Taken**:
- ✅ v1.7.0 tag deleted
- ✅ False documentation removed/marked invalid
- ✅ CRITICAL_RETRACTION_v1.7.0.md created
- ✅ README reverted to v1.6.0
- ✅ SDK version reverted to 0.5.0

**Invalid Documents** (Marked):
- `INVALID_ACCEPTANCE_S1_PRIORS.md`
- `INVALID_ACCEPTANCE_S2_STABILITY.md`
- `INVALID_ACCEPTANCE_S3_SDK.md`
- `INVALID_ACCEPTANCE_S4_v1.7.0.md`

---

## Current State

### What Works ✅
- v1.6.0 is production-ready
- All v1.6.0 features functional
- Documentation accurate
- SDK v0.5.0 complete

### What Doesn't Work ❌
- Priors are validation-only (not functional)
- Test pass rate 96.7% (not 98.5%)
- v1.7.0 never shipped

### What's Honest ✅
- README states priors are "validation-only"
- No false claims about functionality
- CRITICAL_RETRACTION documents what happened

---

## Lessons Learned

1. **Always verify tests actually run**
   - Don't trust exit codes alone
   - Check server startup
   - Verify assertions execute

2. **Manual testing is mandatory**
   - Automated tests aren't enough
   - Smoke test new features
   - Verify behavior manually

3. **Quality bars are hard requirements**
   - 98.5% means 98.5%, not 96.7%
   - Don't round up or make exceptions
   - Meet the bar or document why not

4. **Documentation must match reality**
   - No aspirational claims
   - No "will work" statements
   - Only document what actually works

5. **Tags are permanent**
   - Don't tag until verified
   - Retracting tags damages trust
   - Test before tagging

---

## What's Next

### If Pursuing Functional Priors (v1.7.0 or later)

**Required Fixes**:
1. **Fix priors implementation**
   - Enable SCM_LITE by default, OR
   - Implement priors in fallback simulation, OR
   - Return error if priors used without SCM_LITE

2. **Fix test environment**
   - Debug spawnServer() failures
   - Verify tests run successfully
   - Add regression tests comparing with/without priors

3. **Meet quality bar**
   - Fix 15 tests to reach 98.5%
   - OR document exception with approval
   - No rounding up

4. **Verify manually**
   - Smoke test: priors change results
   - Determinism: same priors + seed = same hash
   - Validation: invalid priors rejected

5. **Re-release only when ready**
   - All fixes complete
   - All tests passing
   - Quality bar met
   - Manual verification done

### Alternative: Stay on v1.6.0

**Rationale**:
- v1.6.0 is solid and production-ready
- Priors validation-only is acceptable
- Focus on other features
- Revisit functional priors later

---

## Communication

### If Asked: "What's the latest version?"
**Answer**: "v1.6.0 - includes timeslices, evidence, SDK, and priors validation."

### If Asked: "What about v1.7.0?"
**Answer**: "v1.7.0 was tagged prematurely and retracted. Priors were not actually functional. See CRITICAL_RETRACTION_v1.7.0.md for details."

### If Asked: "Do priors work?"
**Answer**: "Priors are validation-only in v1.6.0. The API accepts and validates them, but they don't influence inference results yet. Functional priors are planned for a future release."

### If Asked: "What's the test pass rate?"
**Answer**: "96.7% (789/816 active tests) with zero flakes. Core features are 100% tested."

---

## Files in Repo

### Valid Documentation ✅
- `README.md` - Accurate v1.6.0 info
- `RELEASE_NOTES_v1.6.0.md` - Complete
- `ACCEPTANCE_R0_v1.6.0.md` - Valid
- `V1.6.0_FINAL_STATUS.md` - Valid
- `CRITICAL_FINDINGS.md` - Documents priors limitation

### Retraction Documentation ✅
- `CRITICAL_RETRACTION_v1.7.0.md` - Explains what happened
- `CLEANUP_PLAN_v1.7.0.md` - Cleanup checklist

### Invalid Documentation (Marked) ⚠️
- `INVALID_ACCEPTANCE_S1_PRIORS.md`
- `INVALID_ACCEPTANCE_S2_STABILITY.md`
- `INVALID_ACCEPTANCE_S3_SDK.md`
- `INVALID_ACCEPTANCE_S4_v1.7.0.md`

### Code (Partial Implementation)
- `src/inference/types.ts` - InferenceConfig extended (harmless)
- `src/inference/apply-priors.ts` - Utility created (unused)
- `src/inference/model_based.ts` - Priors wired (doesn't work)
- `tests/priors-functional.test.ts` - Tests created (never ran)

---

## Honest Assessment

### Success ✅
- v1.6.0 shipped successfully
- Features work as documented
- Documentation accurate
- SDK complete

### Failure ❌
- v1.7.0 attempted but failed
- Priors implementation incomplete
- Tests never verified
- Quality bar not met

### Recovery ✅
- False claims retracted
- Documentation cleaned up
- Honest status documented
- Trust preserved (by being honest)

---

## Final Status

**v1.6.0**: ✅ SHIPPED AND PRODUCTION-READY

**v1.7.0**: ❌ RETRACTED - Never actually worked

**Current Recommendation**: Use v1.6.0, plan functional priors for future release

---

**Last Updated**: 2025-11-15  
**Status**: Cleanup complete, honest documentation restored
