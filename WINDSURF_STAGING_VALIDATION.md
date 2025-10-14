# Windsurf Staging Validation Prompt

**Goal**: Validate staging after flag ON, capture Evidence Pack, and post results.

**Copy-paste this entire section to Windsurf for automated validation**

---

## Instructions

### 1. Determinism & Performance

**A. Run 10× Hash Check**

```bash
# Both response_hash and bma_hash on golden_seed42_chain3.json
for i in {1..10}; do
  curl -sS -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer <STAGING_TOKEN>' \
    -d @fixtures/golden_seed42_chain3.json \
    https://<staging-url>/v1/run | jq -r '[.model_card.response_hash,.model_card.bma_hash]|join(" ")'
done | sort | uniq -c
```

**Expected**: `10 <same-hash> <same-hash>`

**Action**: Append result to `STAGING_VALIDATION.md` under "Determinism Check"

---

**B. Run Latency Spot Check (20 calls)**

```bash
# Report p95 latency
seq 1 20 | xargs -I{} bash -c \
  'curl -sS -H "Content-Type: application/json" \
   -H "Authorization: Bearer <STAGING_TOKEN>" \
   -d @fixtures/golden_seed42_chain3.json \
   https://<staging-url>/v1/run -w "%{time_total}\n" -o /dev/null' \
| awk '{sum+=$1; arr[NR]=$1} END{
  n=NR; 
  asort(arr); 
  p95=arr[int(0.95*n)]; 
  min=arr[1];
  median=arr[int(0.5*n)];
  print "Min:",min,"s | Median:",median,"s | p95:",p95,"s | Budget: 0.6s | Margin:",(0.6/p95)"x"
}'
```

**Expected**: p95 < 0.1s (6× under budget)

**Action**: Append result to `STAGING_VALIDATION.md` under "Performance Check"

---

### 2. Health Metrics

**A. Snapshot Before Load**

```bash
# Capture baseline
curl -sS https://<staging-url>/v1/health | jq '{
  engine_p95_ms,
  engine_p95_ms_rolling,
  json_429_count,
  sse_429_count,
  idem_cache_size,
  timestamp: now
}' > health_before.json

cat health_before.json
```

**Action**: Append to `STAGING_VALIDATION.md` under "Health Metrics (Before)"

---

**B. Generate Load (30 requests)**

```bash
# Send 30 requests with varying seeds
for i in {1..30}; do
  jq --argjson seed $i '.seed=$seed' fixtures/golden_seed42_chain3.json \
  | curl -sS -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer <STAGING_TOKEN>' \
    -d @- https://<staging-url>/v1/run > /dev/null
  sleep 0.5
done
```

---

**C. Snapshot After Load**

```bash
# Capture after load
curl -sS https://<staging-url>/v1/health | jq '{
  engine_p95_ms,
  engine_p95_ms_rolling,
  json_429_count,
  sse_429_count,
  idem_cache_size,
  timestamp: now
}' > health_after.json

cat health_after.json
```

**Action**: Append to `STAGING_VALIDATION.md` under "Health Metrics (After)"

---

### 3. Evidence Pack

**A. Build Pack**

```bash
npm run pack:build
```

---

**B. Verify Canonical Files**

```bash
# Check presence
ls -la artifact/pack/evidence/

# Expected files:
# - pack-meta.json
# - slos.live.json
# - report_v1.seed42.json
```

**Action**: Confirm all files present in `STAGING_VALIDATION.md`

---

**C. Extract SHA256 Hashes**

```bash
# SHA256 of report_v1.seed42.json
sha256sum artifact/pack/evidence/report_v1.seed42.json

# SHA256 of slos.live.json
sha256sum artifact/pack/evidence/slos.live.json

# BMA hash from report
jq -r '.model_card.bma_hash' artifact/pack/evidence/report_v1.seed42.json
```

**Action**: Paste all hashes to `STAGING_VALIDATION.md` under "Evidence Pack Hashes"

---

### 4. Rate-Limit Proof

**A. Send 3 Requests with Different Seeds**

```bash
# Record HTTP codes
for s in 1001 1002 1003; do
  jq --argjson seed $s '.seed=$seed' fixtures/golden_seed42_chain3.json \
  | curl -sS -o /dev/null -w "Seed $s: %{http_code}\n" \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer <STAGING_TOKEN>' \
    -d @- https://<staging-url>/v1/run
done
```

**Expected** (if `RATE_LIMIT_RPM=2`):
```
Seed 1001: 200
Seed 1002: 200
Seed 1003: 429
```

**Action**: Record HTTP codes and RPM env in `STAGING_VALIDATION.md`

---

**B. Add Rationale Note**

Add this note to `STAGING_VALIDATION.md` under "Rate-Limit Validation":

```
Note: Different seeds → different idempotency keys. 
Identical payloads trigger idempotency replay and are exempt from RPM counting by design.
This is why we vary the seed for rate-limit tests.
```

---

### 5. Finalize

**A. Create STAGING_VALIDATION.md**

Structure:

```markdown
# Staging Validation Report

**Date**: <current-date>
**Environment**: Staging
**Flag Status**: SCM_LITE_ENABLE=1

## Summary Table

| Check | Status | Details |
|-------|--------|---------|
| Determinism | PASS/FAIL | 10/10 identical hashes |
| Performance | PASS/FAIL | p95 = X.XXs (Xx margin) |
| Rate-Limiting | PASS/FAIL | 429 after RPM exceeded |
| Health Metrics | PASS/FAIL | All fields present |
| Evidence Pack | PASS/FAIL | Canonical files verified |

## Determinism Check

<paste 10× hash check output>

## Performance Check

<paste latency spot check output>

## Health Metrics (Before)

<paste health_before.json>

## Health Metrics (After)

<paste health_after.json>

## Evidence Pack Hashes

- report_v1.seed42.json SHA256: <hash>
- slos.live.json SHA256: <hash>
- BMA hash: <hash>

## Rate-Limit Validation

<paste HTTP codes>

Note: Different seeds → different idempotency keys. 
Identical payloads trigger idempotency replay and are exempt from RPM counting by design.

## Raw Outputs

<links to any log files or artifacts>

## Conclusion

Overall Status: PASS/FAIL

Recommendation: Proceed to 24-48h monitoring / Investigate issues

---

**Validated by**: Windsurf AI
**Date**: <timestamp>
```

---

**B. Open PR (Optional)**

If using GitHub:

```bash
git checkout -b staging-validation
git add STAGING_VALIDATION.md
git commit -m "docs: staging validation report (flag ON)"
git push origin staging-validation
# Open PR with summary table
```

---

## Exit Criteria

All assertions must pass:

- ✅ Determinism: 10/10 identical response_hash + bma_hash
- ✅ Performance: p95 < 100ms (6× under budget)
- ✅ Rate-Limiting: 429 after RPM exceeded
- ✅ Health Metrics: All fields present, counters incrementing
- ✅ Evidence Pack: Canonical files present, hashes valid

---

## Output

Generate:
1. **STAGING_VALIDATION.md** with all sections above
2. Console summary with pass/fail status
3. Evidence Pack archive location

---

**Note**: Replace `<staging-url>` and `<STAGING_TOKEN>` with actual values before running.
