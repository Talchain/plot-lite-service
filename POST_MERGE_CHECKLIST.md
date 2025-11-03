# Post-Merge Checklist for PR #69

## 1. Verify Render Auto-Deploy

**URL:** https://plot-lite-service.onrender.com  
**Dashboard:** https://dashboard.render.com

**Steps:**
1. Check Render dashboard for new deployment
2. Wait for "Live" status
3. Note the build hash/timestamp

---

## 2. Run Production Smoke Tests

```bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service
./.tmp/smoke-tests.sh
```

**Expected Results:**
- Health: `{"status": "ok", "version": "..."}`
- Limits: `{"nodes": {"max": 200}, "edges": {"max": 500}}`
- Validate: `{"valid": true, "violations": []}`
- Determinism: H1 == H2 (identical hashes)

---

## 3. Post Results to PR #69

After smoke tests pass, comment on PR #69:

```markdown
## Production Verification ✅

**Deployed:** [timestamp]  
**Build:** [hash]

### Smoke Tests
- ✅ Health: OK
- ✅ Limits: Working
- ✅ Validate: Working
- ✅ Determinism: Verified

### Determinism Hashes
```
H1=[hash1]
H2=[hash2]
```
H1 == H2 ✅

**Status:** Production deployment successful
```

---

## 4. Verify Production Environment Variables

**Render → Environment:**

Required:
- `RATE_LIMIT_ENABLED=1`
- `TEST_ROUTES=0`
- `SSE_HEARTBEAT_MS=15000`
- `SSE_SLOT_MAX_MS=60000`
- `CORS_ALLOWLIST=[UI origin]`

Debug features (OFF by default):
- `COMPARE_VIEW_ENABLE=0`
- `INSPECTOR_DEBUG_ENABLE=0`

---

## 5. Notify UI Team

Post to UI channel/issue:

```markdown
## Backend P0 Unblock: LIVE ✅

**Production URL:** https://plot-lite-service.onrender.com

### What's Available
1. **result.response_hash** - Deterministic SHA-256 hash in all `/v1/run` responses
2. **GET /v1/limits** - Returns `{nodes: {max: 200}, edges: {max: 500}}`
3. **POST /v1/validate** - Pre-flight validation for graph payloads
4. **Shape enforcement** - API now strictly validates edge format

### Required Edge Shape
```json
{
  "from": "string",
  "to": "string", 
  "weight": number,
  "label": "string",
  "body": "string",
  "belief": number (optional),
  "provenance": "string" (optional)
}
```

**Rejected fields:** `source`, `target`, `position`, nested `data`, `type`

### Determinism Verified
Two identical `/v1/run` calls → identical `result.response_hash`

### Debug Features
Debug slices (`debug.inspector`, `debug.compare`) remain behind feature flags and are OFF in production.

**Status:** Ready for UI integration ✅
```

---

## 6. Monitor for Issues

**First 24 hours:**
- Watch Render logs for errors
- Monitor `/v1/health` metrics
- Check for any UI integration issues

**Rollback if needed:**
- Render → Deploys → Select previous → Rollback
- Or: `git revert [merge-commit] && git push`

---

## 7. Begin A-Grade Stabilization (PR #70)

**URL:** https://github.com/Talchain/plot-lite-service/pull/70

**Goal:** ≥97% pass rate, ≤2 variance, P1A/P1B clean

**Next Steps:**
1. Fix P1A/P1B debug slice tests
2. Fix SCM-Lite test isolation
3. Fix secret guard test
4. Add 3× verification CI
5. Achieve A-grade criteria

---

**Checklist:**
- [ ] Render deployment verified
- [ ] Smoke tests passed
- [ ] Results posted to PR #69
- [ ] Environment variables confirmed
- [ ] UI team notified
- [ ] Monitoring active
- [ ] PR #70 ready to start
