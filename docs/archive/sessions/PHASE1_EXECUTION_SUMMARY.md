# Phase 1: Safe PRs — Execution Summary

**Time**: 2025-10-23 14:45 UTC+01:00  
**Status**: Ready to open 3 safe PRs

---

## Baseline Established

- **Test Status**: 18 failed files | 153 passed | 8 skipped (179 total)
- **Tracking Issue**: `TRACKING_ISSUE_A2_TAXONOMY.md`
- **Baseline Log**: `BASELINE_TEST_RUN_20251023_144203.log`

---

## Safe PRs (Do NOT Increase Failures)

### 1. P2-1 Stream Canary
**Branch**: `feat/p2-1-clean-integration-final`  
**Files**: 4 (metrics, plugins, stream route, tests)  
**Tests**: 4/4 passing  
**Risk**: Low (additive metrics only)

**PR Body Template**:
```markdown
## P2-1: Stream Canary Header + Metrics

### Changes
- Canonical header: `X-Enable-Enhanced-Stream`
- Legacy header: `X-Stream-Enhanced` (deprecated, tracked)
- Metrics: `plot_engine_stream_canary_total`, `plot_engine_stream_deprecated_header_total`
- Tests: 4/4 passing

### Known Status
This PR does not add failures. The 18 failed test files are inherited from the A2 taxonomy migration (tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`). Feature-specific tests in this PR are green.

### Proofs
```bash
# Start server
PORT=3500 PROMETHEUS_ENABLE=1 AUTH_ENABLED=0 node dist/main.js &
sleep 2

# Test canonical header
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20

# Test legacy header
curl -i -H "X-Stream-Enhanced: TRUE" "http://localhost:3500/v1/stream?demo=1" | head -20

# Check metrics
curl -s http://localhost:3500/metrics | grep -E "plot_engine_stream_(canary|deprecated_header)_total"

kill %1
```

### Rollback
Single-commit revert, no data migration.

### Security
- No secrets in logs
- Tokens redacted
- Bounded metrics labels (route-level only)
```

---

### 2. P2 Determinism Stamp
**Branch**: `feat/p2-determinism-stamp`  
**Files**: 3 (JCS hash lib, tests, proof script)  
**Tests**: 11/11 passing  
**Risk**: Low (additive metadata)

**PR Body Template**:
```markdown
## P2: Determinism Stamp (JCS Hash)

### Changes
- `model_card.response_hash`: SHA-256 hex of JCS-normalized response
- `model_card.response_hash_algo`: "sha256"
- `model_card.normalized`: true
- Excludes volatile fields: `trace_id`, `meta.response_id`, `meta.elapsed_ms`
- Tests: 11/11 passing (including 5× identical hash proof)

### Known Status
This PR does not add failures. The 18 failed test files are inherited from the A2 taxonomy migration (tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`). Feature-specific tests in this PR are green.

### Proofs
```bash
# Start server
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

# Run 5× with same seed
for i in {1..5}; do 
  curl -s "http://localhost:3500/v1/run?seed=1337" | jq -r '.model_card.response_hash'
done | sort | uniq -c

# Expected: 5 identical hashes (one unique value)

kill %1
```

### Rollback
Single-commit revert, no data migration.

### Security
- No PII in hash
- Deterministic algorithm (RFC 8785 JCS)
```

---

### 3. P3 ETag Caching
**Branch**: `feat/p3-etag-caching`  
**Files**: 2 (tests, proof script)  
**Tests**: 5/5 passing  
**Risk**: Low (tests only, read-only endpoint)

**PR Body Template**:
```markdown
## P3: ETag Caching for /v1/limits

### Changes
- Tests for ETag/304 behavior on `/v1/limits`
- Weak ETag: `W/"..."`
- `Cache-Control: max-age=60, must-revalidate`
- `If-None-Match` → 304
- Tests: 5/5 passing

### Known Status
This PR does not add failures. The 18 failed test files are inherited from the A2 taxonomy migration (tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`). Feature-specific tests in this PR are green.

### Proofs
```bash
# Start server
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

# First request (200 + ETag)
ETAG=$(curl -sD - http://localhost:3500/v1/limits -o /dev/null | awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
echo "ETag: $ETAG"

# Second request with If-None-Match (304)
curl -s -o /dev/null -w "Status: %{http_code}\n" -H "If-None-Match: $ETAG" http://localhost:3500/v1/limits

# Expected: Status: 304

kill %1
```

### Rollback
Single-commit revert, no data migration.

### Security
- No PII in response
- Cache-friendly for read-only data
```

---

## Next Steps

1. Open 3 PRs using templates above
2. Verify CI passes (or matches baseline)
3. Proceed to Phase 2 (P1 Error Envelope fix)

---

**Status**: ✅ Ready to open PRs
