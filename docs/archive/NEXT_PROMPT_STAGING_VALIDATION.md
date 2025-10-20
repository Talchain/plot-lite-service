# Next Prompt: Stage Deploy SCM-Lite (Flag OFF → ON), Validate, and Publish Evidence Pack

**Copy-paste this to Windsurf for automated staging validation**

---

## Objective

Deploy SCM-Lite to staging, validate with flag OFF then ON, and generate a comprehensive Staging Validation Report.

---

## Instructions

### 1. Preflight

Run build, test, gates, audit and print exact counts:

```bash
npm run build
npm test  # Print: X/Y passing
npm run gates  # Print: X/Y PASS
npm audit --omit=dev  # Print: X vulnerabilities
```

### 2. Deploy to Staging (Flag OFF)

Set environment:
```bash
SCM_LITE_ENABLE=0
SCM_LITE_K=500
SCM_LITE_BELIEF_DEFAULT=0.5
AUTH_ENABLED=1
NODE_ENV=production
```

Then:

**A. Call `/v1/health`**
- Print: `last_compute_ms`, `engine_p95_ms`, `engine_p95_ms_rolling`

**B. Call `/v1/run` (fixed body+seed) 10×**
- Use seed=42, simple A→B graph
- Assert: All 10 `response_hash` values identical
- Log all 10 hashes

**C. Confirm production-mode warning**
- Check logs for: `"SCM_LITE disabled — using placeholder results"`
- Assert: Warning appears at least once

### 3. Flip to SCM_LITE_ENABLE=1

Redeploy with flag ON, then:

**A. Repeat `/v1/run` 10×**
- Use seed=9999, A→B→C chain graph
- Assert: All 10 `response_hash` identical
- Assert: All 10 `bma_hash` identical (now present)
- Log all 10 hash pairs

**B. Performance check (30 calls)**
- Send 30 requests with varying seeds (1-30)
- Confirm: `engine_p95_ms < 100ms` steady
- Print: min, median, p95 of `engine_p95_ms`

**C. Rate-limit check**
- Send 3 runs with seeds 1001, 1002, 1003
- Assert: At least one 429 response (if RPM ≤ 3)
- Note: Different seeds → different idempotency keys; identical payloads replay and don't count toward RPM by design

### 4. Build Evidence Pack

Run:
```bash
npm run pack:build
```

Show presence and JSON shape of:
- `artifact/pack/evidence/pack-meta.json`
- `artifact/pack/evidence/slos.live.json`
- `artifact/pack/evidence/report_v1.seed42.json` (if exists)

Print:
- Commit SHA from pack-meta.json
- p95_ms from slos.live.json
- response_hash and bma_hash from report_v1.seed42.json

### 5. Produce Staging Validation Report

Create a markdown report with:

**Section 1: Preflight Results**
- Test count: X/Y passing (Z%)
- Gate count: X/Y PASS
- Vulnerabilities: X
- Build status: Success/Fail

**Section 2: Flag OFF Validation**
- Health metrics: last_compute_ms, engine_p95_ms, engine_p95_ms_rolling
- Determinism: 10/10 identical response_hash (list unique count)
- Production warning: Present/Absent
- bma_hash: Absent (as expected)

**Section 3: Flag ON Validation**
- Determinism: 10/10 identical response_hash + bma_hash (list unique counts)
- Performance: min/median/p95 of engine_p95_ms over 30 calls
- Budget margin: (600ms / p95) = Xx headroom
- Rate-limiting: 429 count (expected ≥1)
- Health counters: json_429_count, idem_cache_size

**Section 4: Evidence Pack**
- Pack path: artifact/pack/...
- Commit SHA: ...
- Build timestamp: ...
- SLO p95_ms: ...
- Canonical files present: pack-meta.json, slos.live.json, report_v1.seed42.json
- Checksums valid: Yes/No

**Section 5: Anomalies & Follow-ups**
- List any unexpected results
- Suggest follow-up actions if needed
- Confirm flag remains ON in staging

**Section 6: Conclusion**
- Overall status: PASS/FAIL
- Recommendation: Proceed to production rollout / Investigate issues

---

## Exit Criteria

All assertions pass:
- ✅ Preflight: 7/7 gates, ~98% tests, 0 vulns
- ✅ Flag OFF: Health metrics visible, determinism verified, warning present
- ✅ Flag ON: BMA hash present, p95 < 100ms, rate-limiting works
- ✅ Evidence Pack: Canonical files present, checksums valid
- ✅ Report posted
- ✅ Flag remains ON in staging

---

## Output

Generate:
1. **STAGING_VALIDATION_REPORT.md** with all sections above
2. Console summary with pass/fail status
3. Evidence Pack archive location

---

**Note**: This is a copy-paste prompt for future staging validation. Adjust API endpoints and tokens as needed for your environment.
