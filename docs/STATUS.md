# PLoT Engine - Production Status

**Last Updated**: 2025-10-20 23:02 UTC+01:00  
**Deploy SHA**: `ab222c0` (merged to main)  
**Environment**: Render Production

---

## Current Production State ✅

### Deployment Info
- **Branch**: `main`
- **Merge Commit**: `ab222c0` - feat(metrics): validation counter fix + request schema
- **Status**: Deployed and verified
- **Render**: Auto-deploy from main enabled

### Environment Configuration
```bash
PROMETHEUS_ENABLE=1                    # ✅ Metrics exposed
PRINCIPAL_HMAC_SECRET_ACTIVE=<64-hex>  # ✅ Active secret set
PRINCIPAL_HMAC_SECRET_STAGED=          # ✅ Empty (no rotation)
STREAM_PARITY_ENABLE=0                 # ✅ Legacy streaming only
```

---

## Live Verification (Production Proof)

### 1. Health Check - Principal Extraction
```bash
$ curl -s https://plot-lite-service.onrender.com/v1/health | jq '.principal_extraction'
```
**Output**:
```json
{
  "enabled": true,
  "trust_proxy": false,
  "hops": 1,
  "mode": "fallback",
  "secrets": {
    "active": true,
    "staged": false
  }
}
```
✅ **Status**: Principal extraction enabled with active secret

---

### 2. Invalid Request Returns 400
```bash
$ curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'content-type: application/json' -d '{}' \
  https://plot-lite-service.onrender.com/v1/run
```
**Output**: `400`

✅ **Status**: Validation working correctly

---

### 3. Validation Metric Sample Line
```bash
$ curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"}'
```
**Output**:
```
plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"} 5
```
✅ **Status**: Metric emitting samples, counter incrementing correctly

---

## Feature Flags & Rollout Status

| Feature | Flag/Header | Status | Notes |
|---------|-------------|--------|-------|
| Prometheus Metrics | `PROMETHEUS_ENABLE=1` | ✅ Live | Exposed at `/metrics` |
| Principal Extraction | `PRINCIPAL_HMAC_SECRET_ACTIVE` | ✅ Live | Fallback mode, active secret |
| Validation Metrics | N/A | ✅ Live | Counter working as expected |
| Enhanced Streaming | `STREAM_PARITY_ENABLE=0` | 🔒 Disabled | Legacy path only |
| Stream Resume | N/A | 🚧 Not wired | Foundation exists |

---

## Recent Changes

### Validation Metrics Fix (2025-10-20)
- **PR**: #34
- **Commits**: `04aabef`, `8e02d16`, `bd806d9`
- **Changes**:
  - Error handler returns 400 for validation errors
  - Request schema added to `/v1/run` requiring `graph` field
  - E2E tests fixed to use `app.listen()`
  - Repo hygiene: `.bak` files removed
- **Impact**: `plot_engine_validation_errors_total` now emits samples

---

## Known Issues & Limitations

### Non-Blockers
- Some E2E tests have minor flakiness (stream disconnect tests)
- Test 2 in validation metric suite skipped (payload adjustment needed)
- Multiple status documents in root (cleanup pending)

### Upcoming Work
- **P0.5**: Organize documentation, clean root directory
- **P1**: CI fully green, no flaky tests
- **P2**: Enhanced streaming canary with header-based rollout

---

## Rollback Procedures

### Validation Metrics Fix
```bash
git revert ab222c0
git push origin main
# Render will auto-deploy previous behavior
```

### Secret Rotation (if needed)
1. Set `PRINCIPAL_HMAC_SECRET_STAGED=<new-64-hex>`
2. Monitor for 24h (both secrets valid)
3. Swap: `ACTIVE=<new>`, `STAGED=<empty>`
4. Monitor for 24h
5. Confirm old tokens rejected

---

## Monitoring & Alerts

### Key Metrics to Watch
```promql
# Request rate
rate(plot_engine_request_duration_seconds_count[5m])

# Validation errors
increase(plot_engine_validation_errors_total[5m])

# Error rate
rate(plot_engine_request_duration_seconds_count{status=~"5.."}[5m])
```

### Health Checks
- `/v1/health` - Should return 200 with principal_extraction.enabled=true
- `/metrics` - Should return 200 with Prometheus metrics
- `/v1/run` with valid payload - Should return 200 with run.v1 schema

---

## Support & Documentation

- **Runbooks**: `docs/runbooks/`
- **Metrics Catalog**: `docs/observability/METRICS_CATALOG.md`
- **Reports**: `docs/reports/`
- **Contributing**: `CONTRIBUTING.md`
- **Deployment**: `DEPLOYING.md`

---

**Status**: ✅ **PRODUCTION STABLE**  
**Next Review**: After P0.5 documentation cleanup
