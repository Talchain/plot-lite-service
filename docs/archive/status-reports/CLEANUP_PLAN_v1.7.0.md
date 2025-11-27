# Cleanup Plan: Remove False v1.7.0 Claims

**Date**: 2025-11-15  
**Status**: 🔴 URGENT - False documentation in repo

---

## Current State

### ✅ Completed
- v1.7.0 tag deleted
- CRITICAL_RETRACTION_v1.7.0.md created

### ❌ Still Contains False Claims
- README.md claims "New in v1.7.0: Functional Priors"
- RELEASE_NOTES_v1.7.0.md claims priors are functional
- ACCEPTANCE_S1_PRIORS.md claims priors work
- ACCEPTANCE_S4_v1.7.0.md claims v1.7.0 shipped
- MISSION_COMPLETE.md claims both releases shipped

---

## Required Cleanup

### 1. Revert README.md
**Current** (FALSE):
```markdown
## ✨ New in v1.7.0

- **Functional Priors** - Priors now influence inference results
- **Test Stabilization** - ≥98.5% pass rate with zero flakes
```

**Should Be**:
```markdown
## ✨ New in v1.6.0

- **Timeslices** (`/v1/run_timeslices`) - Evaluate graphs across multiple time periods
- **Priors** - Initialize node beliefs (⚠️ validation-only, functional in future release)
- **Evidence** - Annotate requests with evidence metadata
- **TypeScript SDK** - Full-featured SDK with client-side validation
```

### 2. Delete or Mark Invalid
- `RELEASE_NOTES_v1.7.0.md` - Delete (never shipped)
- `ACCEPTANCE_S1_PRIORS.md` - Mark as INVALID
- `ACCEPTANCE_S2_STABILITY.md` - Mark as INVALID
- `ACCEPTANCE_S3_SDK.md` - Mark as INVALID (SDK v0.5.1 not needed)
- `ACCEPTANCE_S4_v1.7.0.md` - Mark as INVALID
- `MISSION_COMPLETE.md` - Update to reflect only v1.6.0

### 3. Revert Code Changes
**Keep**:
- InferenceConfig type extension (harmless)
- applyPriorsToGraph utility (for future use)
- Validation logic (already worked)

**Consider Removing**:
- tests/priors-functional.test.ts (never worked)
- Priors wiring in /v1/run (doesn't work without SCM_LITE)

---

## What Actually Shipped

### v1.6.0 ✅ (Valid)
- Timeslices endpoint
- Evidence annotations (all endpoints)
- TypeScript SDK v0.5.0
- Priors validation (validation-only)
- OpenAPI contracts aligned

### v1.7.0 ❌ (Invalid - Never Shipped)
- Priors claimed functional but aren't
- Tests claimed passing but never ran
- Quality bar claimed met but wasn't

---

## Recommended Actions

### Immediate (Now)

1. **Revert README.md**
   - Remove v1.7.0 section
   - Restore v1.6.0 section with priors caveat

2. **Delete False Release Notes**
   ```bash
   rm RELEASE_NOTES_v1.7.0.md
   ```

3. **Mark Acceptance Docs Invalid**
   - Prefix with `INVALID_` or move to archive folder
   - Add header: "⚠️ INVALID - v1.7.0 never shipped"

4. **Update Mission Complete**
   - Remove v1.7.0 claims
   - Document only v1.6.0 success

5. **Commit Cleanup**
   ```bash
   git add -A
   git commit -m "fix: remove false v1.7.0 claims from documentation"
   ```

### Short-term (If Pursuing v1.7.0)

6. **Fix Priors Implementation**
   - Enable SCM_LITE by default, OR
   - Implement priors in fallback simulation, OR
   - Return error if priors used without SCM_LITE

7. **Fix Test Environment**
   - Debug spawnServer() failures
   - Verify tests actually run
   - Verify tests compare with/without priors

8. **Meet Quality Bar**
   - Fix 15 tests to reach 98.5%, OR
   - Document exception with approval

9. **Re-release v1.7.0**
   - Only when priors actually work
   - Only when tests pass
   - Only when quality bar met

---

## Files to Clean Up

### Delete
- [ ] `RELEASE_NOTES_v1.7.0.md`
- [ ] `tests/priors-functional.test.ts` (optional)

### Revert
- [ ] `README.md` (remove v1.7.0 section)
- [ ] `sdk/package.json` (revert to v0.5.0)
- [ ] `sdk/CHANGELOG.md` (remove v0.5.1 entry)
- [ ] `sdk/README.md` (remove v1.7.0 reference)

### Mark Invalid
- [ ] `ACCEPTANCE_S1_PRIORS.md` → `INVALID_ACCEPTANCE_S1_PRIORS.md`
- [ ] `ACCEPTANCE_S2_STABILITY.md` → `INVALID_ACCEPTANCE_S2_STABILITY.md`
- [ ] `ACCEPTANCE_S3_SDK.md` → `INVALID_ACCEPTANCE_S3_SDK.md`
- [ ] `ACCEPTANCE_S4_v1.7.0.md` → `INVALID_ACCEPTANCE_S4_v1.7.0.md`

### Update
- [ ] `MISSION_COMPLETE.md` (remove v1.7.0, keep v1.6.0 only)

---

## Verification Checklist

After cleanup:
- [ ] No references to "v1.7.0" in README.md
- [ ] No references to "functional priors" in current docs
- [ ] SDK version is 0.5.0 (not 0.5.1)
- [ ] Only v1.6.0 tag exists
- [ ] CRITICAL_RETRACTION_v1.7.0.md explains what happened
- [ ] All false acceptance docs marked invalid

---

## Communication

### If Asked About v1.7.0
**Response**:
> "v1.7.0 was tagged prematurely and has been retracted. The priors feature was not actually functional (SCM_LITE disabled by default, fallback simulation ignores priors). Tests never ran successfully. We've reverted to v1.6.0 as the current release. See CRITICAL_RETRACTION_v1.7.0.md for details."

### If Asked About Priors
**Response**:
> "Priors are validation-only in v1.6.0. The API accepts priors and validates them, but they don't influence inference results yet. Functional priors are planned for a future release once the implementation is complete and tested."

---

## Lessons Learned

1. **Always verify tests actually run** - Don't trust exit codes alone
2. **Manual testing is mandatory** - Especially for new features
3. **Quality bars are hard requirements** - Not negotiable
4. **Documentation must match reality** - No aspirational claims
5. **Tags are permanent** - Don't tag until verified

---

**Status**: 🔴 CLEANUP REQUIRED

**Next Step**: Execute cleanup actions above
