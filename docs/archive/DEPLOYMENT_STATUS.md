# 🚀 Phase 0 Deployment - Live Status

## ✅ Completed Steps

### 1. Code Merged to Main ✅
- **PR**: https://github.com/Talchain/plot-lite-service/pull/33
- **Commit**: Squashed merge to main
- **Branch**: `gates/v0.3.3` deleted after merge
- **Time**: 2025-10-13 18:08 UTC+01:00

### 2. Render Auto-Deploy Triggered ✅
- **Status**: Deploying (502 detected - service updating)
- **URL**: https://plot-lite-service.onrender.com
- **Monitor**: https://dashboard.render.com

---

## 🔄 In Progress

### Waiting for Render Deployment
Render typically takes 2-5 minutes to build and deploy. Current status: **DEPLOYING**

**Check deployment status:**
```bash
# Quick health check
curl -s https://plot-lite-service.onrender.com/v1/health | jq .

# Or watch until 200
watch -n 5 'curl -s -o /dev/null -w "%{http_code}" https://plot-lite-service.onrender.com/v1/health'
```

---

## 📋 Next Steps (Once Deployed)

### Step 1: Run Staging Smoke Tests
```bash
./STAGING_SMOKE_TESTS.sh
```

**Manual tests if script fails:**
```bash
export ENGINE_URL="https://plot-lite-service.onrender.com"

# Test 1: ETag + 304
curl -I "$ENGINE_URL/draft-flows" | grep -i etag
ETAG=$(curl -sI "$ENGINE_URL/draft-flows" | grep -i etag | cut -d' ' -f2 | tr -d '\r')
curl -I -H "If-None-Match: $ETAG" "$ENGINE_URL/draft-flows" | grep "HTTP"

# Test 2: POST /v1/run
curl -s -X POST "$ENGINE_URL/v1/run" \
  -H 'Content-Type: application/json' \
  -d '{"seed":12345,"inputs":{}}' | jq '{bands: .summary.bands, confidence: .confidence, schema: .schema}'

# Test 3: Health
curl -s "$ENGINE_URL/v1/health" | jq .
```

### Step 2: Flip UI to Live on Staging
Update UI environment variables:
```bash
FEATURE_RESULTS_SOURCE="live"
ENGINE_BASE_URL="https://plot-lite-service.onrender.com"
ENGINE_TIMEOUT_MS=12000
```

Test in UI:
- Navigate to Results page
- Trigger a run
- Verify results display correctly
- Test rate limiting (make multiple rapid requests)
- Verify 429 banner shows countdown

### Step 3: Run Claude/Tools Gates Against Staging
```bash
# Set staging URL
export ENGINE_URL="https://plot-lite-service.onrender.com"

# Run gates
npm run gates

# Check output
cat GATES_STATUS.md
```

**Expected gates:**
- ✅ SLO (≥500 samples, p95 ≤ 600ms)
- ✅ Determinism (10× stable hashes)
- ✅ Pack + Trust (canonical ZIP with checksums)

### Step 4: Monitor for 15 Minutes
**Metrics to watch:**
- Response times: p95 ≤ 600ms for /draft-flows
- Error rates: 5xx ~0
- Rate limiting: 429s with proper headers
- Memory/CPU: Stable

**Monitoring commands:**
```bash
# Response time sampling
for i in {1..10}; do
  time curl -s "$ENGINE_URL/draft-flows" > /dev/null
  sleep 5
done

# Error rate check
curl -s "$ENGINE_URL/v1/health" | jq '{status, uptime_ms}'
```

---

## 🔄 Rollback Plan (If Needed)

**Option A: Revert via Git**
```bash
git revert HEAD
git push origin main
# Wait for Render to redeploy
```

**Option B: Redeploy Previous Version via Render**
1. Go to https://dashboard.render.com
2. Select plot-lite-service
3. Go to "Manual Deploy" → "Deploy previous version"
4. Select the version before this deployment

---

## 📝 Post-Deploy Cleanup (Non-Blocking)

Track these items for follow-up PRs:
- [ ] D-sep symmetry tests (academic correctness)
- [ ] Dev OpenAPI/ETag refinements
- [ ] Health counter test timing fix
- [ ] Idempotency test harness polish
- [ ] SSE gate server startup timeout

---

## 📊 Success Criteria

**GO Criteria:**
- [ ] All smoke tests pass
- [ ] UI displays results correctly
- [ ] Rate limiting works as expected
- [ ] No 5xx errors in logs
- [ ] Response times within SLO (p95 < 600ms)
- [ ] Gates pass (5/7 minimum)

**Current Status**: 🟡 **DEPLOYING** → Will update to 🟢 **LIVE** once verified

---

**Deployment Lead**: Phase 0 Team  
**Start Time**: 2025-10-13 18:08 UTC+01:00  
**Target**: Staging (https://plot-lite-service.onrender.com)
