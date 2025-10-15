# PLoT-Lite Service Alert Runbook

## Performance Alert: Rolling P95 > 100ms

**Trigger**: `engine_p95_ms_rolling` exceeds 100ms for 5+ consecutive minutes

**What to check**:

1. **Check /v1/health**:
   ```bash
   curl https://plot-lite-service.onrender.com/v1/health
   ```
   - Look at `engine_p95_ms_rolling` (current rolling average)
   - Check `engine_p95_ms` (recent window)
   - Verify `status:"ok"`

2. **Check rate limits**:
   - `last5m_429`: High 429 count indicates traffic spike
   - `idem_cache_size`: Growing cache may indicate replay attacks
   - `json_429_count` / `sse_429_count`: Total 429s

3. **Check recent deploys**:
   - Review last PR merged to main
   - Check if new feature flags were enabled
   - Look for schema/algorithm changes

**Common causes**:
- Traffic spike (check rate limit metrics)
- Large/complex graphs (check recent request patterns)
- Deployment regression (rollback if recent deploy)
- Resource contention (check Render metrics)

**Rollback procedure**:
1. Identify last known good commit
2. Deploy previous version via Render dashboard
3. Monitor `/v1/health` until p95 drops below 100ms

**Escalation**:
- If p95 > 200ms for 10+ minutes: immediate rollback
- If rollback doesn't help: check Render logs for errors
