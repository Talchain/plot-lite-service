# Phase 0 Deployment Checklist

## ✅ Pre-Push Complete

**Commit**: `02253ec` on branch `gates/v0.3.3`  
**Pushed**: https://github.com/Talchain/plot-lite-service/tree/gates/v0.3.3

### Changes Summary
- Fixed idempotency LRU cap (10 entries max)
- Normalized INTERNAL errors to "Something went wrong"
- Removed duplicate OpenAPI dev route
- D-sep Bayes-ball rules applied (collider handling)
- Health counters always exposed
- CORS rate-limit headers verified

### Quality Metrics
- **Tests**: 260/267 passing (97.4%)
- **Gates**: 5/7 passing (71%)
- **Build**: Clean, no TypeScript errors
- **UI Contract**: GET /draft-flows unchanged, POST /v1/run stable

---

## 🚀 Staging Deployment Steps

### 1. Merge to Main (or Deploy Branch)
```bash
git checkout main
git merge gates/v0.3.3
git push origin main
```

### 2. Wait for CI/CD Deploy to Staging
Monitor: https://dashboard.render.com (or your deployment platform)

### 3. Run Smoke Tests on Staging

**Set staging URL:**
```bash
export ENGINE_URL="https://plot-lite-service.onrender.com"
```

**Test 1: Draft Flows ETag Parity**
```bash
# Get ETag
curl -I "$ENGINE_URL/draft-flows" | grep -i etag

# Test 304 with If-None-Match
ETAG=$(curl -sI "$ENGINE_URL/draft-flows" | grep -i etag | cut -d' ' -f2 | tr -d '\r')
curl -I -H "If-None-Match: $ETAG" "$ENGINE_URL/draft-flows" | grep "HTTP"
# Expected: HTTP/1.1 304 Not Modified
```

**Test 2: Run Contract**
```bash
curl -s -X POST "$ENGINE_URL/v1/run" \
  -H 'Content-Type: application/json' \
  -d '{"seed":12345,"inputs":{}}' | jq '{
    bands: .summary.bands,
    confidence: .confidence,
    trace_id: .meta.trace_id,
    schema: .schema
  }'
# Expected: bands.{p10,p50,p90} present, confidence enum, schema: "run.v1"
```

**Test 3: 429 Rate Limit Headers**
```bash
# Make 4 rapid requests (if RPM=3)
for i in {1..4}; do
  echo "Request $i:"
  curl -i -X POST "$ENGINE_URL/v1/run" \
    -H 'Content-Type: application/json' \
    -d "{\"seed\":$i,\"inputs\":{}}" 2>&1 | \
    grep -E "HTTP/|Retry-After:|X-RateLimit-Reset:|X-RateLimit-Reason:"
  echo "---"
done
# Expected: 4th request returns 429 with all three headers
```

**Test 4: Health Endpoint**
```bash
curl -s "$ENGINE_URL/v1/health" | jq '{
  status: .status,
  json_429_count: .json_429_count,
  sse_429_count: .sse_429_count
}'
# Expected: status: "ok", counters present (may be 0)
```

---

## 🎯 UI Integration Steps

### 1. Update UI Environment Variables (Staging)
```bash
FEATURE_RESULTS_SOURCE="live"
ENGINE_BASE_URL="https://plot-lite-service.onrender.com"
ENGINE_TIMEOUT_MS=12000
```

### 2. Test UI → Engine Integration
- Navigate to Results page in UI
- Trigger a run
- Verify results display correctly
- Test rate limiting (make multiple rapid requests)
- Verify 429 handling shows retry UI

### 3. Monitor for 15 Minutes
- Check error rates in logs
- Verify response times (p95 < 600ms for /draft-flows)
- Confirm no 5xx errors

---

## ✅ Go/No-Go Decision

**GO Criteria:**
- [ ] All smoke tests pass
- [ ] UI displays results correctly
- [ ] Rate limiting works as expected
- [ ] No 5xx errors in logs
- [ ] Response times within SLO

**If GO:**
- Proceed to production deployment
- Monitor closely for first hour
- Have rollback plan ready

**If NO-GO:**
- Rollback to previous version
- Investigate failures
- Fix and re-test

---

## 📊 Monitoring Dashboards

- **Render Dashboard**: https://dashboard.render.com
- **GitHub Actions**: https://github.com/Talchain/plot-lite-service/actions
- **Logs**: Check Render logs or your logging platform

---

## 🔄 Rollback Plan

If issues arise:
```bash
# Revert to previous commit
git revert 02253ec
git push origin main

# Or redeploy previous version via Render dashboard
```

---

## 📝 Post-Deployment Tasks

- [ ] Update CHANGELOG.md
- [ ] Create GitHub release/tag
- [ ] Update documentation if needed
- [ ] Close related issues
- [ ] Notify team of successful deployment

---

**Deployment Owner**: [Your Name]  
**Date**: 2025-10-13  
**Time**: 18:05 UTC+01:00
