# Staging Deployment Plan: SCM-Lite Integration

**Date**: October 14, 2025  
**Target**: Staging environment  
**Strategy**: Flag OFF → validate → Flag ON → validate → capture Evidence Pack

---

## Phase 1: Deploy with Flag OFF (Zero Risk)

### Environment Configuration

```bash
# SCM-Lite flags (disabled for initial deploy)
SCM_LITE_ENABLE=0
SCM_LITE_K=500
SCM_LITE_BELIEF_DEFAULT=0.5

# Standard flags
NODE_ENV=production
AUTH_ENABLED=1
RATE_LIMIT_ENABLED=1
RATE_LIMIT_RPM=60
```

### Post-Deploy Checklist

- [ ] **Health endpoint accessible**: `GET /v1/health` returns 200
- [ ] **Engine metrics visible**: Response includes:
  - `last_compute_ms` (number)
  - `engine_p95_ms` (number)
  - `engine_p95_ms_rolling` (number)
- [ ] **Compute metrics non-zero**: After 1-2 requests, `last_compute_ms > 0`
- [ ] **No SCM-Lite warning**: Logs should NOT show "SCM_LITE disabled" (only in production mode)
- [ ] **Baseline performance**: `engine_p95_ms < 10ms` (placeholder results are fast)

### Validation Commands

```bash
# Health check
curl -s https://staging.example.com/v1/health | jq '.last_compute_ms, .engine_p95_ms, .engine_p95_ms_rolling'

# Fixed-seed run (10x for determinism check)
for i in {1..10}; do
  curl -s -X POST https://staging.example.com/v1/run \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "graph": {
        "nodes": [{"id": "A"}, {"id": "B"}],
        "edges": [{"from": "A", "to": "B"}]
      },
      "seed": 42,
      "outcome_node": "B"
    }' | jq -r '.model_card.response_hash'
done | sort | uniq -c
# Expected: 10 identical hashes
```

---

## Phase 2: Enable SCM-Lite (Flag ON)

### Update Environment

```bash
# Enable SCM-Lite
SCM_LITE_ENABLE=1
SCM_LITE_K=500
SCM_LITE_BELIEF_DEFAULT=0.5
```

### Restart & Warm-up

```bash
# Restart service
# Wait 30s for startup
# Send 5 warm-up requests to stabilize JIT
```

### Post-Enable Checklist

- [ ] **Determinism verified**: 10/10 identical `response_hash` with same seed
- [ ] **BMA hash present**: Response includes `model_card.bma_hash`
- [ ] **Performance within budget**: `engine_p95_ms < 100ms` (still 6x under 600ms)
- [ ] **Rolling metric stable**: `engine_p95_ms_rolling` converges after 20-30 requests
- [ ] **No errors**: Zero 5xx responses in logs
- [ ] **Rate-limiting works**: 3 different-seed requests → 3rd returns 429

### Validation Commands

```bash
# Determinism check (10 runs)
for i in {1..10}; do
  curl -s -X POST https://staging.example.com/v1/run \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "graph": {
        "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
        "edges": [{"from": "A", "to": "B"}, {"from": "B", "to": "C"}]
      },
      "seed": 9999,
      "outcome_node": "C"
    }' | jq -r '.model_card.response_hash, .model_card.bma_hash'
done | sort | uniq -c
# Expected: 10 identical response_hash, 10 identical bma_hash

# Performance check
curl -s https://staging.example.com/v1/health | jq '{
  last_compute_ms,
  engine_p95_ms,
  engine_p95_ms_rolling,
  budget_ms: 600,
  margin: (600 / .engine_p95_ms)
}'
```

---

## Phase 3: Capture Evidence Pack

### Generate Pack

```bash
# On staging server
cd /app
npm run pack:build

# Verify canonical structure
ls -la artifact/pack/evidence/
# Expected:
# - pack-meta.json
# - slos.live.json
# - report_v1.seed42.json (if generated)
```

### Validate Pack Contents

```bash
# Check pack-meta.json
cat artifact/pack/evidence/pack-meta.json | jq '{
  schema,
  commit,
  build_timestamp,
  flags
}'

# Check slos.live.json
cat artifact/pack/evidence/slos.live.json | jq '{
  engine_get_p95_ms,
  k_per_sec,
  samples
}'

# Verify checksums
cat artifact/pack/checksums.json | jq '.files | keys'
# Expected: ["checksums.json", "manifest.json", "pack-meta.json", "report_v1.seed42.json", "slos.live.json"]
```

### Download Pack

```bash
# Download Evidence Pack ZIP
scp staging:/app/artifact/engine_pack_*.zip ./evidence/

# Verify SHA-256
sha256sum engine_pack_*.zip
# Compare with artifact/pack/checksums.json
```

---

## Monitoring & Alerts

### Key Metrics

- **engine_p95_ms**: Should stay < 100ms (6x under budget)
- **engine_p95_ms_rolling**: EWMA-smoothed, tracks trends
- **response_hash**: Must be identical for same seed
- **bma_hash**: Must be identical for same seed

### Alert Thresholds

```yaml
alerts:
  - name: scm_lite_p95_high
    condition: engine_p95_ms > 100
    severity: warning
    message: "SCM-Lite p95 above 100ms (still under 600ms budget)"
  
  - name: scm_lite_p95_critical
    condition: engine_p95_ms > 300
    severity: critical
    message: "SCM-Lite p95 above 300ms (approaching budget)"
  
  - name: scm_lite_determinism_drift
    condition: response_hash != expected_hash
    severity: critical
    message: "Determinism violation detected"
```

---

## Rollback Plan

### Immediate Rollback (< 1 minute)

```bash
# Set flag to 0
SCM_LITE_ENABLE=0

# Restart service
# System reverts to placeholder results
```

### Full Rollback (< 5 minutes)

```bash
# Revert to commit before SCM-Lite integration
git checkout <previous_commit>
npm run build
# Restart service
```

---

## Success Criteria

### Phase 1 (Flag OFF)
- ✅ Health metrics visible
- ✅ No errors in logs
- ✅ Baseline performance < 10ms

### Phase 2 (Flag ON)
- ✅ 10/10 deterministic hashes
- ✅ Performance < 100ms p95
- ✅ Rate-limiting validated
- ✅ Zero 5xx errors

### Phase 3 (Evidence Pack)
- ✅ Canonical filenames present
- ✅ Checksums valid
- ✅ SLOs captured
- ✅ Pack downloadable

---

## Next Steps After Staging

1. **Monitor for 24-48 hours**
   - Track `engine_p95_ms_rolling` stability
   - Verify no memory leaks
   - Check error rates

2. **Gradual Production Rollout**
   - Deploy with `SCM_LITE_ENABLE=0`
   - Enable for 1% traffic
   - Ramp to 10% → 50% → 100%

3. **Production Evidence Pack**
   - Capture pack after 1 week
   - Compare SLOs with staging
   - Archive for audit trail

---

## Contact & Support

- **Deployment Issues**: Check logs for "SCM_LITE disabled" warning
- **Performance Issues**: Monitor `engine_p95_ms_rolling` trend
- **Determinism Issues**: Verify seed is fixed in test payload
- **Rate-Limit Issues**: Ensure different seeds for each request

---

**Status**: Ready for staging deployment  
**Risk**: Minimal (flag OFF by default, instant rollback)  
**Estimated Duration**: 2-4 hours (including validation)
