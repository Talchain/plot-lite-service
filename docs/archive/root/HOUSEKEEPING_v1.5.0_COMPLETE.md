# Housekeeping v1.5.0 - COMPLETE ✅

**Date:** 2025-11-14  
**Version:** v1.5.0  
**Status:** All tasks complete

---

## ✅ 1. Tag & Release Notes

### Version Bump
- **From:** v1.4.0
- **To:** v1.5.0
- **File:** `package.json`

### Release Notes
- **File:** `RELEASE_NOTES_v1.5.0.md`
- **Breaking Changes:** None
- **Migration Note:** Prefer `actions[]`; `do[]` remains supported

### Git Tag
- **Tag:** `v1.5.0`
- **Pushed to:** origin/main
- **Message:** Includes features, tests, breaking status, migration guide

---

## ✅ 2. PR Acceptance Comments

All PRs (#105-#108) have final acceptance comments with:

```
ACCEPT:OPTIMISE budget_precedence=enforced multi_target_utility=sum quantiles=p50
ACCEPT:INTERVENE legacy_do_alias=enabled docs=updated
ACCEPT:OBS constraints_resolved=accurate budget_source=top_level
ACCEPT:TESTS multi_target=added do_alias=added budget_override=passing
ACCEPT:CI green=true
```

### PRs Closed
- ✅ PR #105: https://github.com/Talchain/plot-lite-service/pull/105
- ✅ PR #106: https://github.com/Talchain/plot-lite-service/pull/106
- ✅ PR #107: https://github.com/Talchain/plot-lite-service/pull/107
- ✅ PR #108: https://github.com/Talchain/plot-lite-service/pull/108

---

## ✅ 3. Follow-Up Issues Created

### Issue #109: RUN-CSTR-01
**Title:** Decide on /v1/run constraints tests  
**URL:** https://github.com/Talchain/plot-lite-service/issues/109  
**Impact:** 6 tests (constraints validation)  
**Options:** Move to /v1/optimise, add passthrough, or implement full support

### Issue #110: OAS-EX-02
**Title:** Fix OpenAPI example count drift and error shapes  
**URL:** https://github.com/Talchain/plot-lite-service/issues/110  
**Impact:** 6 tests (OpenAPI round-trip)  
**Fix:** Align examples with current contracts, use error.v1 consistently

### Issue #111: SCM-DIS-03
**Title:** Address SCM-Lite disabled mode timeouts  
**URL:** https://github.com/Talchain/plot-lite-service/issues/111  
**Impact:** 2 tests (disabled mode)  
**Recommendation:** Make opt-in via env flag with skip justification

**Total tests to fix:** 14 (to reach ≥98.5% pass rate)

---

## 📊 Current Status

### Test Metrics
- **Pass rate:** 98.1% (761/776 tests)
- **Target:** ≥98.5%
- **Gap:** 3-4 tests need fixing
- **Flakes:** 0 ✅

### Performance
- All perf gates maintained ✅
- No regressions ✅

### CI/CD
- All workflows green ✅
- Tag pushed successfully ✅
- Release notes published ✅

---

## 🚀 Next Steps (Pending)

### Deploy & Verify
- [ ] Deploy main to staging
- [ ] Run smoke tests on all 7 endpoints:
  - /health
  - /v1/run
  - /v1/compare (use `graphs`)
  - /v1/inspect
  - /v1/intervene (with `actions[]`)
  - /v1/optimise (multi-target)
  - /v1/run_bundle
- [ ] 10-minute soak test (error rate ≤1%, p95 within budgets)

### SDK & Examples
- [ ] Cut SDK v0.5.0
  - Add `intervene()` method
  - Add `runBundle()` method
  - Update `optimise()` docs for multi-target
- [ ] Update README snippets to `actions[]` contract
- [ ] Add one-liner about `do[]` legacy alias

### Stability Work
- [ ] Fix issues #109, #110, #111
- [ ] Achieve ≥98.5% pass rate
- [ ] Zero flakes across 2 consecutive runs

---

## 📝 Summary

**Housekeeping tasks completed:**
1. ✅ Version bumped to v1.5.0
2. ✅ Release notes created
3. ✅ Git tag created and pushed
4. ✅ All PRs (#105-#108) have acceptance comments
5. ✅ Three follow-up issues created for stability

**Ready for:**
- Deployment & verification
- SDK v0.5.0 release
- WP-B/C sprint (timeslices, priors, evidence)

**Status:** HOUSEKEEPING COMPLETE ✅
