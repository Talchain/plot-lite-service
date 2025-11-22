# Staging Deployment Quick Reference

**Status**: ✅ GO FOR STAGING  
**Date**: October 14, 2025

---

## TL;DR

```bash
# Phase 1: Deploy with flag OFF
SCM_LITE_ENABLE=0

# Phase 2: Flip flag ON
SCM_LITE_ENABLE=1

# Phase 3: Build Evidence Pack
npm run pack:build

# Rollback (instant)
SCM_LITE_ENABLE=0
```

---

## Environment Variables

```bash
# Required
SCM_LITE_ENABLE=0          # Start with 0, flip to 1 after validation
SCM_LITE_K=500             # Number of samples
SCM_LITE_BELIEF_DEFAULT=0.5 # Default edge belief

# Standard
NODE_ENV=production
AUTH_ENABLED=1
RATE_LIMIT_ENABLED=1
RATE_LIMIT_RPM=60          # Adjust as needed
```

---

## Quick Checks

### 1. Health Check (10 seconds)

```bash
curl -sS https://<staging>/v1/health | jq '{
  engine_p95_ms,
  engine_p95_ms_rolling,
  json_429_count,
  sse_429_count,
  idem_cache_size
}'
```

**Expected**: All fields present, numbers

---

### 2. Determinism Check (30 seconds)

```bash
# Flag OFF: 10× identical response_hash
for i in {1..10}; do
  curl -sS -H 'Content-Type: application/json' \
    -d @fixtures/golden_seed42_chain3.json \
    https://<staging>/v1/run | jq -r '.model_card.response_hash'
done | sort | uniq -c
```

**Expected**: `10 <same-hash>`

```bash
# Flag ON: 10× identical response_hash + bma_hash
for i in {1..10}; do
  curl -sS -H 'Content-Type: application/json' \
    -d @fixtures/golden_seed42_chain3.json \
    https://<staging>/v1/run | jq -r '[.model_card.response_hash,.model_card.bma_hash]|join(" ")'
done | sort | uniq -c
```

**Expected**: `10 <same-hash> <same-hash>`

---

### 3. Performance Check (20 seconds)

```bash
# Quick p95 spot check
seq 1 20 | xargs -I{} bash -c \
  'curl -sS -d @fixtures/golden_seed42_chain3.json \
   https://<staging>/v1/run -w "%{time_total}\n" -o /dev/null' \
| awk '{arr[NR]=$1} END{asort(arr); print "p95:",arr[int(0.95*NR)],"s"}'
```

**Expected**: < 0.1s (budget is 0.6s)

---

### 4. Rate-Limit Check (10 seconds)

```bash
# Send 3 requests with different seeds
for s in 1001 1002 1003; do
  jq --argjson seed $s '.seed=$seed' fixtures/golden_seed42_chain3.json \
  | curl -sS -o /dev/null -w "%{http_code}\n" \
    -d @- https://<staging>/v1/run
done
```

**Expected** (if RPM=2): `200 200 429`

---

## Evidence Pack

```bash
# Build
npm run pack:build

# Verify
ls -la artifact/pack/evidence/
# Expected: pack-meta.json, slos.live.json, report_v1.seed42.json

# Extract BMA hash
jq -r '.model_card.bma_hash' artifact/pack/evidence/report_v1.seed42.json
```

---

## Rollback

```bash
# Instant rollback (< 1 minute)
SCM_LITE_ENABLE=0
# Redeploy

# No schema changes, no migration needed
```

---

## Monitoring (24-48h)

### Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| `engine_p95_ms_rolling` | >100ms for 5min | WARNING |
| `engine_p95_ms_rolling` | >300ms for 5min | CRITICAL |
| 5xx rate | >0 | CRITICAL |
| Determinism drift | Any variance | PAGE ON-CALL |

### Daily Check

```bash
# Run daily (automated)
for i in {1..10}; do
  curl -sS -d @fixtures/golden_seed42_chain3.json \
    https://<staging>/v1/run | jq -r '[.model_card.response_hash,.model_card.bma_hash]|join(" ")'
done | sort | uniq -c

# Expected: "10 <same-hash> <same-hash>"
# Any variance → page on-call
```

---

## Known Gotchas

1. **Rate-limit tests**: Must vary seed (1001, 1002, 1003). Identical payloads replay via idempotency cache.
2. **Stream disconnect test**: May show AbortError on teardown (cosmetic, non-impacting).
3. **Quarantined tests**: 5 tests skipped with documented rationale (not on prod paths).

---

## Communications

### Today
```
Deployed to staging (flag OFF). Health visible. Flipping ON after checks.
```

### Tomorrow
```
Flag ON. Determinism/perf validated. Evidence Pack captured. Monitoring 24-48h.
```

### Post-Monitor
```
No regressions. Ready for phased prod rollout. UI unchanged.
```

---

## One-Liner for UI Team

```
Staging now exposes SCM-Lite behind a flag. API contracts unchanged 
(summary.bands p10/p50/p90, confidence, meta.seed, model_card.response_hash + bma_hash). 
No UI work needed; we'll flip the flag after health checks.
```

---

## Files to Reference

- **STAGING_VALIDATION_CHECKLIST.md** - Detailed checklist
- **WINDSURF_STAGING_VALIDATION.md** - Automated validation script
- **STAGING_DEPLOY_PLAYBOOK.md** - Full deployment guide
- **GO_NO_GO_SUMMARY.md** - Executive decision

---

## Support

**Deployment Issues**: Check logs for "SCM_LITE disabled" warning  
**Performance Issues**: Monitor `engine_p95_ms_rolling` trend  
**Determinism Issues**: Verify seed is fixed in test payload  
**Rollback**: Set `SCM_LITE_ENABLE=0` (instant)

---

**Prepared by**: Cascade AI  
**Date**: October 14, 2025  
**Version**: 1.0
