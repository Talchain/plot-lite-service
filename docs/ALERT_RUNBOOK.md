# Alert Runbook

**Quick triage guide for PLoT-Lite Service alerts**

---

## Alert: High Rolling P95 Latency

**Trigger**: `engine_p95_ms_rolling > 100ms` for 5 consecutive minutes

**Severity**: ⚠️ Warning (performance degradation)

---

### Step 1: Check Health Endpoint

```bash
curl https://plot-lite-service-staging.onrender.com/v1/health | jq
```

**Look for**:
- `engine_p95_ms_rolling`: Current rolling p95 (should be < 100ms under normal load)
- `engine_p95_ms`: Instantaneous p95
- `json_429_count`: Rate limit hits (JSON endpoints)
- `sse_429_count`: Rate limit hits (SSE streams)
- `idem_cache_size`: Idempotency cache size
- `uptime_s`: Service uptime

**Red flags**:
- `engine_p95_ms_rolling > 150ms`: Significant degradation
- `json_429_count` or `sse_429_count` increasing rapidly: Rate limit pressure
- `idem_cache_size > 100`: Possible memory pressure

---

### Step 2: Check Rate Limits & Inflight Requests

**Rate limit counters**:
```bash
# Check if rate limits are being hit
curl https://plot-lite-service-staging.onrender.com/v1/health | jq '.json_429_count, .sse_429_count'
```

**Inflight requests** (if TEST_ROUTES=1):
```bash
curl -H "X-Test-Auth: 1" https://plot-lite-service-staging.onrender.com/internal/inflight/stats | jq
```

**Look for**:
- High inflight count (> 10): Possible slow requests backing up
- Many 429s: Rate limit threshold too low or traffic spike

---

### Step 3: Check Memory & Event Loop

**Health metrics**:
```bash
curl https://plot-lite-service-staging.onrender.com/v1/health | jq '{
  uptime_s,
  engine_p95_ms,
  engine_p95_ms_rolling,
  idem_cache_size,
  last_compute_ms
}'
```

**Indicators**:
- `last_compute_ms > 500ms`: Single request taking too long
- `idem_cache_size` growing: Cache not being pruned
- Low `uptime_s` (< 300s): Recent restart/crash

---

### Step 4: Capture Evidence Pack

**Download from GitHub Actions**:
1. Go to: https://github.com/Talchain/plot-lite-service/actions/workflows/evidence-pack.yml
2. Find latest run for deployed commit
3. Download `evidence-pack-<sha>` artifact
4. Extract and review:
   - `pack-meta.json`: Commit, timestamp, flags
   - `slos.live.json`: Performance metrics
   - `report_v1.seed*.json`: Sample response

**Or generate locally** (if you have the commit checked out):
```bash
npm run evidence:generate
ls -lh artifact/pack/evidence/
```

---

### Step 5: Check Feature Flags

```bash
curl https://plot-lite-service-staging.onrender.com/version | jq '.flags'
```

**Expected (staging defaults)**:
```json
{
  "scm_lite_enable": false,
  "auth_enabled": true,
  "rate_limit_enabled": true
}
```

**If `scm_lite_enable: true`**:
- SCM-Lite adds computational overhead
- Check if K value is too high: `SCM_LITE_K` (default: 500)
- Consider temporarily disabling: Set `SCM_LITE_ENABLE=0` in Render dashboard

---

## Common Scenarios

### Scenario A: Traffic Spike

**Symptoms**:
- High `json_429_count` or `sse_429_count`
- `engine_p95_ms_rolling` elevated but < 150ms

**Action**:
1. Confirm legitimate traffic (not attack)
2. Temporarily increase rate limit: `RATE_LIMIT_RPM=120` (default: 60)
3. Monitor for 10 minutes
4. If sustained, consider scaling up Render plan

---

### Scenario B: Slow Compute

**Symptoms**:
- `engine_p95_ms_rolling > 150ms`
- `last_compute_ms > 500ms`
- Low rate limit hits

**Action**:
1. Check if SCM-Lite is enabled: `curl /version | jq '.flags.scm_lite_enable'`
2. If enabled, check K value: Should be ≤ 500 for staging
3. Check request complexity: Large graphs (> 12 nodes) may be slow
4. Review recent code changes for performance regressions

---

### Scenario C: Memory Pressure

**Symptoms**:
- `idem_cache_size > 100`
- Service restarting frequently (low `uptime_s`)

**Action**:
1. Check cache pruning: Should auto-prune at 10 entries
2. Review idempotency key usage: Are clients reusing keys correctly?
3. Consider reducing `IDEM_TTL_MS` (default: 10 minutes)
4. Check for memory leaks in recent deployments

---

## Rollback Procedure

### Quick Rollback (Feature Flag)

**Disable SCM-Lite** (if causing issues):
1. Go to Render dashboard → `plot-lite-service-staging`
2. Environment → Edit `SCM_LITE_ENABLE`
3. Change from `1` to `0`
4. Save (triggers redeploy in ~2 minutes)

### Full Rollback (Previous Commit)

1. Go to Render dashboard → `plot-lite-service-staging`
2. Click **Manual Deploy**
3. Select previous commit from dropdown
4. Click **Deploy**
5. Monitor health endpoint for 5 minutes

---

## Escalation

**If issue persists after 15 minutes**:
1. Capture Evidence Pack (Step 4)
2. Take screenshot of `/v1/health` response
3. Note recent deployments/changes
4. Create incident ticket with:
   - Commit SHA (from `/version`)
   - Health metrics snapshot
   - Evidence Pack artifact link
   - Timeline of actions taken

---

## Prevention

**Before enabling SCM-Lite on staging**:
1. Run load probe: `npm run load:probe` (when implemented)
2. Verify `engine_p95_ms_rolling < 50ms` under 25 RPS
3. Monitor for 24 hours before enabling in production

**Regular checks**:
- Weekly: Review Evidence Pack metrics
- Monthly: Analyze p95 trends
- Quarterly: Load test with realistic traffic patterns

---

## Useful Commands

```bash
# Quick health check
curl -s https://plot-lite-service-staging.onrender.com/v1/health | jq '{engine_p95_ms_rolling, json_429_count, uptime_s}'

# Check version and flags
curl -s https://plot-lite-service-staging.onrender.com/version | jq

# Run smoke test
export PLOT_STAGING_URL=https://plot-lite-service-staging.onrender.com
export AUTH_TOKEN=<your-token>
npm run smoke:staging

# Generate evidence pack locally
npm run evidence:generate
```

---

**Last Updated**: October 15, 2025  
**Maintained by**: Platform Team
