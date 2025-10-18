# Alert Runbook

Operations guide for triaging PLoT Engine alerts and anomalies.

## Idempotency Quota Hits (C1)

**Symptom**: `idem_evictions_total` counter increasing rapidly in `/v1/health`.

**Cause**: Single principal exceeding 100 keys/principal quota, or total cache exceeding 5k entries.

**Triage**:
1. Check `idem_principals` vs `idem_cache_size` ratio
2. If ratio is low (<50), single principal is dominating
3. Review logs for repeated `Idempotency-Key` patterns from same IP/token
4. Consider temporary IP block or token revocation

**Fix**: Increase `maxKeysPerPrincipal` in `PrincipalQuotas` if legitimate traffic.

---

## IPv6 Canonicalization Anomalies (C2)

**Symptom**: Rate limiting bypassed via mixed IPv6 forms (e.g., `::1`, `::ffff:127.0.0.1`).

**Cause**: Client rotating between compressed/expanded IPv6 addresses.

**Triage**:
1. Check rate limit bucket counts via `/__test/rl-bucket` (test routes enabled)
2. Look for multiple buckets from same logical IP
3. Verify `canonicalizeRemote()` is applied in rate limiter

**Fix**: Already mitigated by C2. If bypass persists, check for proxy misconfiguration.

---

## SSE Timeouts & Cleanup (C3)

**Symptom**: `sse_timeout` counter incrementing, clients report stream cuts.

**Cause**: Streams exceeding `SSE_MAX_MS` (default 120s).

**Triage**:
1. Check `sse_open` vs `sse_closed` + `sse_timeout` (should sum to total opens)
2. Review logs for `reqId` with "sse timeout" message
3. Verify `inflight` returns to 0 (no leaks)

**Knobs**:
- `SSE_MAX_MS`: Increase if legitimate long-running streams (e.g., `SSE_MAX_MS=300000` for 5min)

**Fix**: Timeout ensures cleanup. If clients need longer streams, increase `SSE_MAX_MS`.

---

## Prometheus /metrics Usage (C4 + P1)

**When**: `PROMETHEUS_ENABLE=1` exposes `/metrics` endpoint.

**Histograms (P1)**:
- `plot_engine_request_duration_seconds`: HTTP request duration
  - Labels: `route`, `method`, `status_class`
  - Buckets: 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, +Inf (seconds)
- `plot_engine_engine_latency_seconds`: Core engine compute latency
  - Labels: `phase`, `status_class`
  - Same buckets

**Key Gauges**:
- `engine_p95_ms`: Current engine P95 latency
- `engine_p95_ms_rolling`: Rolling P95 (5min window)
- `json_429_total`: Total 429 responses (JSON endpoints)
- `sse_429_total`: Total 429 responses (SSE endpoint)
- `idem_cache_size`: Current idempotency cache size

**Quick Check**:
```bash
curl http://localhost:3000/metrics | grep plot_engine_request_duration
```

**Grafana Queries** (PromQL):
```promql
# Request latency P95
histogram_quantile(0.95, rate(plot_engine_request_duration_seconds_bucket[5m]))

# Request rate by route
sum(rate(plot_engine_request_duration_seconds_count[5m])) by (route)

# Error rate (4xx + 5xx)
sum(rate(plot_engine_request_duration_seconds_count{status_class=~"4xx|5xx"}[5m]))
```

**Security**: 
- Keep `PROMETHEUS_ENABLE=0` in production unless scraping via internal network
- No PII in metrics (no IPs, tokens, or user IDs)
- Bounded label cardinality (only static route/method/status labels)

---

## Sustained P95 > 100ms (Phase-A Alert)

**Symptom**: `engine_p95_ms_rolling` > 100ms for 5+ minutes.

**Cause**: High load, inefficient graph, or external dependency latency.

**Triage**:
1. Check `/v1/health` for `engine_p95_ms_rolling`
2. Review recent request patterns (large graphs, high belief counts)
3. Check `inflight` count (backpressure indicator)

**Fix**: Scale horizontally, optimize graph complexity, or investigate SCM-Lite kernel.

---

## OpenAPI Rate Limit (C4)

**Symptom**: `/openapi.json` returns 429 with `Retry-After: 60`.

**Cause**: IP exceeded 10 req/min.

**Triage**:
1. Check if legitimate scraper or bot
2. Review IP in logs for pattern

**Fix**: Whitelist IP or increase limit in `createServer.ts` (currently hardcoded 10/min).

---

## General Debugging

**Health Check**:
```bash
curl http://localhost:3000/v1/health | jq .
```

**Version & Flags**:
```bash
curl http://localhost:3000/version | jq .flags
```

**Determinism Verification** (seed 4242):
```bash
# Run 3x, expect identical response_hash
for i in {1..3}; do
  curl -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{"seed":4242,"graph":{"nodes":[{"id":"A"}],"edges":[]},"outcome_node":"A"}' \
    | jq -r '.model_card.response_hash'
done
```

---

## Cache Performance Monitoring (P0.2)

**Available in**: `/v1/health` (always exposed)

**Fields**:
- `idem_cache_stats`: Idempotency cache performance
  - `hits`: Number of cache hits
  - `misses`: Number of cache misses
  - `evictions`: Number of entries evicted (LRU)
  - `size`: Current cache size
  - `hitRate`: Hit rate (0-1, higher is better)
- `fixtures_cache_stats`: Fixture cache performance (same structure)

**Healthy Baseline**:
- `idem_cache_stats.hitRate` ≥ 0.85 (85% hit rate)
- `fixtures_cache_stats.hitRate` ≥ 0.90 (90% hit rate)

**Triage Low Hit Rate**:
1. Check if `misses` are increasing rapidly (key churn)
2. Review `evictions` count (cache too small?)
3. Look for principal fragmentation (many unique tokens/IPs)
4. Consider increasing cache size in `createServer.ts` (idemCache maxSize)

**Example**:
```bash
curl -s http://localhost:3000/v1/health | jq '{idem_cache_stats, fixtures_cache_stats}'
```

---

## What-If Delta (Optional Feature)

**Flag**: `WHATIF_DELTA_ENABLE=1` (default: OFF)

**Purpose**: Experimental sensitivity analysis showing how perturbing the first edge affects outcomes.

**Behavior**:
- **OFF (default)**: No `whatif_delta` field in responses
- **ON**: Adds `whatif_delta` to response with:
  - `perturbation`: String describing edge perturbation (e.g., "A→B weight +0.1")
  - `outcome_delta`: Numeric delta in outcome value

**Operator Notes**:
- Feature is deterministic (same graph → same delta)
- Uses first edge only (simplified analysis)
- No schema drift when OFF
- Safe to enable for testing/demos
- Not recommended for production without UI coordination

**Example**:
```bash
# With flag ON
WHATIF_DELTA_ENABLE=1 npm start

# Response includes:
# "whatif_delta": {
#   "perturbation": "A→B weight +0.1",
#   "outcome_delta": 0.04
# }
```

---

## /ops/snapshot vs /v1/health (P2)

**When to use `/ops/snapshot`:**
- Need comprehensive ops visibility (runtime, caches, SSE, flags)
- Investigating multi-component issues (cache + rate-limit + SSE)
- Requires auth (X-OPS-KEY or Bearer token)
- Flag-gated: `OPS_SNAPSHOT_ENABLE='1'`

**When to use `/v1/health`:**
- Quick liveness/readiness check
- Public endpoint (no auth required)
- Lighter payload (no redaction overhead)
- Always available (no flag)

**Example `/ops/snapshot` usage:**
```bash
# With X-OPS-KEY
curl -H "X-OPS-KEY: $OPS_KEY" http://localhost:3000/ops/snapshot | jq

# Check cache hit rates
curl -H "X-OPS-KEY: $OPS_KEY" http://localhost:3000/ops/snapshot \
  | jq '.caches.idempotency.hitRate'

# Check all feature flags
curl -H "X-OPS-KEY: $OPS_KEY" http://localhost:3000/ops/snapshot \
  | jq '.flags'
```

**Redaction expectations:**
- Response includes `"redactions"` array listing removed fields
- Never contains: Authorization headers, raw tokens, OPS_KEY, TOKEN_HMAC_SECRET
- Safe to share in incident channels (PII-free)

---

## Contract Validation Errors (WP-P4)

**Always-On:** No flag required

**Symptom:** 400 responses with `code: "BAD_INPUT"`

**Error Format:**
```json
{
  "code": "BAD_INPUT",
  "message": "Missing required field: graph",
  "field": "graph",
  "hint": "Include 'graph' in your request"
}
```

**Common Causes:**
1. **Missing required field:** Client forgot `graph` or `outcome_node`
2. **Unknown field:** Typo in field name (e.g., `graphX` instead of `graph`)
3. **Wrong type:** Sent string instead of integer for `seed`
4. **Bounds exceeded:** Too many nodes (>12) or edges (>20)

**Triage:**
```bash
# Check error details
curl -s http://localhost:3000/v1/run \
  -H 'Content-Type: application/json' \
  -d '{"graphX":{}}' | jq

# Expected:
# {
#   "code": "BAD_INPUT",
#   "field": "graphX",
#   "hint": "Remove 'graphX' or check spelling"
# }
```

**Resolution:**
1. **Check `field`:** Identifies the problematic field
2. **Read `hint`:** Provides actionable guidance
3. **Validate against schema:** `contracts/plot.run.request.v1.json`
4. **Test with minimal payload:** `{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}`

**Prevention:**
- Use TypeScript SDK (auto-validates)
- Validate against JSON schema before sending
- Check API docs for required fields

---

## Circuit Breaker (WP-P3)

**Flag:** `RL_CB_ENABLE='1'` (default: OFF)

**Purpose:** Prevents burst cascades by opening circuit on sustained overload.

**States:**
- `closed` - Normal operation
- `open` - Circuit tripped, rejecting requests with 503
- `half_open` - Recovery mode, probing with limited requests

**Symptom:** 503 responses with `X-RateLimit-Reason: circuit_open_*`

**Triage:**
```bash
# Check circuit state
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker'

# Expected output:
# {
#   "global": { "state": "open", "failures": 52, "successes": 0 },
#   "principals": { "tracked": 15, "open": 2, "half_open": 0 }
# }
```

**Causes:**
1. **Sustained 429s:** ≥50 rate-limit rejections in 10s window
2. **Burst traffic:** QPS exceeds threshold
3. **Noisy neighbor:** Single principal causing cascades

**Resolution:**
1. **Wait for cooldown:** Circuit auto-recovers after 30s (default)
2. **Check logs:** Look for spike in 429s or high QPS
3. **Identify principal:** Check `principals.open` count
4. **Temporary disable:** `RL_CB_ENABLE=0` + restart (if false positive)

**Monitoring:**
```promql
# Circuit open events
increase(plot_engine_circuit_open_total[5m])

# 503 rate
rate(plot_engine_request_duration_seconds_count{status_class="5xx"}[5m])
```

**Rollback:**
```bash
export RL_CB_ENABLE=0
# Restart service
```

---

## Escalation

If triage steps don't resolve:
1. Collect evidence pack: `npm run pack:build`
2. Attach logs with `reqId` correlation
3. Include `/v1/health` snapshot (including cache stats + circuit_breaker)
4. Include `/ops/snapshot` if available (redacted, safe to share)
5. Tag @eng-platform in incident channel

---

## Circuit Breaker & Principal Extraction (PR-1/2A/2B/2C/2C.1/3)

**Overview**: Rate-limit circuit breaker prevents cascade failures by opening circuits on sustained 429 overload. Principal extraction provides secure, HMAC-based identity for per-principal isolation.

### Symptoms & Alerts

**Common Alerts:**
- `plot_engine_circuit_open_total` spike (global or principal scope)
- `plot_engine_rate_limit_429_total` surge
- `/v1/health.circuit_breaker.principals.open > 0` trending up
- `/v1/health.principal_extraction.mode != "fallback"` (degraded mode)

**Dashboard Queries (PromQL):**

```promql
# Circuit opens by reason (5m window)
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate per route (5m window)
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeout events (15m window)
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))

# Probe success rate (5m window)
sum(increase(plot_engine_circuit_probes_total{result="success"}[5m])) 
/ 
sum(increase(plot_engine_circuit_probes_total[5m]))
```

**Health Endpoint Checks:**

```bash
# Quick status
curl -s http://localhost:3000/v1/health | jq '{
  principal_extraction,
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  }
}'

# Check for degraded mode
curl -s http://localhost:3000/v1/health | jq '.principal_extraction.mode'
# Expected: "fallback" (NOT "degraded")

# Check global circuit state
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global.state'
# Expected: "closed" (NOT "open" or "half_open")

# Check principal circuit distribution
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.principals | {tracked, open, half_open}'
```

---

### Triage Checklist (Fast Path)

**Step 1: Verify Configuration**
```bash
# Check if breaker is enabled
curl -s http://localhost:3000/v1/health | jq '.version.flags.RL_CB_ENABLE'

# Check principal extraction status
curl -s http://localhost:3000/v1/health | jq '.principal_extraction'
```

**Step 2: Identify Mode**
- **mode="degraded"**: Missing `PRINCIPAL_HMAC_SECRET` → per-principal CB disabled (global only)
- **mode="fallback"**: Normal operation (HMAC-based principals)

**Step 3: Check Circuit States**
```bash
# Global circuit
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global | {
  state,
  failures,
  state_duration_ms,
  last_transition_at
}'

# Principal circuits
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.principals | {
  tracked,
  open,
  half_open,
  capacity
}'
```

**Step 4: Review Metrics**
```bash
# Check metrics for reason labels
curl -s http://localhost:3000/metrics | grep circuit_open_total

# Expected patterns:
# plot_engine_circuit_open_total{scope="global",reason="threshold"} N
# plot_engine_circuit_open_total{scope="principal",reason="half_open_timeout"} M
```

---

### Remediation Playbooks

#### 1. Degraded Mode (Missing Secret)

**Symptom**: `principal_extraction.mode="degraded"`, per-principal CB disabled

**Root Cause**: `RL_CB_ENABLE=1` but `PRINCIPAL_HMAC_SECRET` not set

**Fix:**
```bash
# Generate secret (64-hex recommended)
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)

# Store in vault (production)
vault kv put secret/plot-engine PRINCIPAL_HMAC_SECRET="$PRINCIPAL_HMAC_SECRET"

# Redeploy with secret
# Verify health after deploy
curl -s http://localhost:3000/v1/health | jq '.principal_extraction.mode'
# Should return: "fallback"
```

**Validation:**
- Health shows `enabled: true`, `mode: "fallback"`
- Logs show no "[circuit-breaker] RL_CB_ENABLE=1 but PRINCIPAL_HMAC_SECRET missing" error
- Per-principal circuits start tracking (check `principals.tracked`)

---

#### 2. Global Circuit Open (Legitimate Load Spike)

**Symptom**: `circuit_breaker.global.state="open"`, 503 responses with `X-RateLimit-Reason: circuit_open_global`

**Root Cause**: Sustained 429s exceeding `RL_CB_FAILURE_THRESHOLD` (default: 50) in `RL_CB_WINDOW_MS` (default: 10s)

**Triage:**
```bash
# Check failure count and threshold
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker | {
  global_failures: .global.failures,
  threshold: .window.failureThreshold,
  window_ms: .window.windowMs
}'

# Check 429 rate
curl -s http://localhost:3000/metrics | grep rate_limit_429_total
```

**Temporary Mitigation (Increase Threshold):**
```bash
# Raise threshold by 20-30% temporarily
export RL_CB_FAILURE_THRESHOLD=65  # was 50
export RL_CB_WINDOW_MS=12000       # was 10000

# Restart service
# Document rollback plan
```

**Permanent Fix:**
- Investigate upstream 429 sources (rate limiter, quota exhaustion)
- Consider scaling capacity or adding perimeter throttling
- Review baseline 429 p95 and adjust thresholds accordingly

**Rollback:**
```bash
# Restore defaults
unset RL_CB_FAILURE_THRESHOLD
unset RL_CB_WINDOW_MS
# Restart service
```

---

#### 3. Principal Circuits Open (Bot/Flood Attack)

**Symptom**: `principals.open > 0`, specific principals tripping circuits

**Root Cause**: Individual principals (IPs, auth users) generating sustained 429s

**Triage:**
```bash
# Check principal circuit distribution
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.principals'

# Review perimeter logs for offending sources
# (principals are opaque HMACs, correlate via request logs)
```

**Mitigation:**
1. **Perimeter block**: Add IP/CIDR blocks at WAF/LB
2. **Auth rate limits**: Tighten per-user quotas if authenticated
3. **Route-level limits**: Lower rate limits on affected routes

**Breaker Tuning (if legitimate):**
```bash
# Increase per-principal threshold
export RL_CB_FAILURE_THRESHOLD=75  # was 50

# Or increase cooldown to reduce oscillation
export RL_CB_COOLDOWN_MS=45000     # was 30000
```

---

#### 4. Half-Open Timeout Spikes

**Symptom**: `circuit_open_total{reason="half_open_timeout"}` increasing

**Root Cause**: Circuits entering half-open but no probe requests arriving within timeout (default: 60s)

**Triage:**
```bash
# Check timeout events
curl -s http://localhost:3000/metrics | grep 'half_open_timeout'

# Check half-open timeout config
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.config.half_open_timeout_ms'
```

**Analysis:**
- **Low traffic**: Circuit opened during off-peak, no requests to probe recovery
- **Persistent overload**: System still unhealthy, probes fail or don't arrive

**Fix (Increase Timeout):**
```bash
# Extend timeout modestly (60s → 90s)
export RL_CB_HALF_OPEN_TIMEOUT_MS=90000

# Restart and monitor probe success rate
curl -s http://localhost:3000/metrics | grep circuit_probes_total
```

**Validation:**
- Timeout events decrease
- Probe success rate improves
- Circuits close after successful probes

---

### Trusted Proxy Configuration

**When to Enable:**
- Service behind reverse proxy/load balancer
- Need to trust `X-Forwarded-For` for canonical remote address

**Configuration:**
```bash
# Enable trusted proxy mode
export TRUST_PROXY=1
export TRUST_PROXY_HOPS=1  # Number of trusted proxy hops

# Example: ALB → Service (1 hop)
# X-Forwarded-For: client_ip, alb_ip
# Canonical remote = client_ip (rightmost - 1 hop)
```

**Security Warning:**
- `TRUST_PROXY=0` (default): Ignores `X-Forwarded-For` completely (anti-spoofing)
- `TRUST_PROXY=1`: Honors rightmost N hops (ensure proxy chain is trusted)
- **Never enable without verifying proxy configuration**

**Validation:**
```bash
# Check config
curl -s http://localhost:3000/v1/health | jq '.principal_extraction | {trust_proxy, hops}'

# Test with forged XFF (should be ignored when TRUST_PROXY=0)
curl -H "X-Forwarded-For: 1.2.3.4" http://localhost:3000/v1/run
```

---

### Rollout & Rollback

#### Enable Sequence (Canary → Production)

**Stage 1: Metrics Only (Safe)**
```bash
# Deploy with breaker OFF (metrics collection only)
export RL_CB_ENABLE=0
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)

# Validate metrics appear
curl -s http://localhost:3000/metrics | grep circuit_open_total
```

**Stage 2: Canary Enable**
```bash
# Enable on canary instances
export RL_CB_ENABLE=1

# Monitor for 1 hour:
# - circuit_open_total (should be 0 or low)
# - rate_limit_429_total baseline
# - principal_extraction.mode="fallback"
```

**Stage 3: Progressive Rollout**
- 25% → wait 24h
- 50% → wait 24h
- 100% → monitor for 48h

**Rollback (Instant, No Restart):**
```bash
# Disable enforcement immediately
export RL_CB_ENABLE=0

# Metrics continue collecting
# No service restart required
# Validate via health
curl -s http://localhost:3000/v1/health | jq '.version.flags.RL_CB_ENABLE'
```

---

### Tuning Guide

#### Choosing Thresholds

**Baseline Analysis:**
```bash
# Measure baseline 429 rate (1 week)
# p50, p95, p99 of 429s per 10s window

# Example baseline:
# p50: 5 failures/10s
# p95: 20 failures/10s
# p99: 45 failures/10s

# Set threshold at p99 + 10% headroom
export RL_CB_FAILURE_THRESHOLD=50  # 45 * 1.1
```

**Burstiness Considerations:**
- **Bursty traffic**: Increase `RL_CB_WINDOW_MS` (10s → 15s) to smooth spikes
- **Steady load**: Keep default 10s window
- **Drip attacks**: Lower threshold (50 → 30) for faster detection

**SLO Alignment:**
- **Availability SLO**: Set threshold to trip before cascading failures
- **Latency SLO**: Ensure circuit opens before p95 latency degrades
- **Error budget**: Trip circuit when error rate exceeds budget

#### Rate Limiter vs Circuit Breaker

**Interaction:**
1. **Rate limiter** (first line): Per-principal/route quotas, returns 429
2. **Circuit breaker** (last resort): Trips on sustained 429s, returns 503

**Which Trips First?**
- Normal: Rate limiter (429) → client backs off
- Overload: Rate limiter saturated → breaker trips (503) → protect service

**Tuning:**
- Rate limiter: Tight quotas (per-user, per-route)
- Circuit breaker: Loose thresholds (system-wide protection)

---

### SLOs & Alert Rules

#### Recommended Alerts

**Critical: Global Circuit Open**
```promql
# Alert if global circuit opens
increase(plot_engine_circuit_open_total{scope="global"}[5m]) > 0
```
**Severity**: P1 (page immediately)  
**Action**: Follow "Global Circuit Open" playbook

---

**Warning: Half-Open Timeout Spike**
```promql
# Alert if >5 timeout events in 15m
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m])) > 5
```
**Severity**: P2 (investigate within 1h)  
**Action**: Check probe success rate, consider timeout increase

---

**Warning: Degraded Mode**
```promql
# Alert if principal extraction degraded
max_over_time(health.principal_extraction.mode[1m]) == "degraded"
```
**Severity**: P2 (fix within 4h)  
**Action**: Set `PRINCIPAL_HMAC_SECRET` and redeploy

---

**Info: Principal Circuit Opens**
```promql
# Alert if >10 principal circuits open
max_over_time(health.circuit_breaker.principals.open[5m]) > 10
```
**Severity**: P3 (review daily)  
**Action**: Investigate offending principals, consider perimeter blocks

---

### Runbook Drills (Quarterly)

**Drill 1: Canary Enable**
- Deploy with `RL_CB_ENABLE=0`
- Enable on canary
- Verify metrics and health
- Rollback to OFF
- **Target**: <5 min end-to-end

**Drill 2: Degraded Mode Recovery**
- Deploy without `PRINCIPAL_HMAC_SECRET`
- Verify degraded mode in health
- Generate and set secret
- Redeploy
- Verify fallback mode
- **Target**: <15 min end-to-end

**Drill 3: Load Spike Response**
- Simulate 429 surge (load test)
- Observe circuit open
- Increase threshold temporarily
- Verify circuit closes
- Rollback threshold
- **Target**: <10 min detection to mitigation

---

### FAQ & Gotchas

**Q: What does `principals.ttl_ms: null` mean in health?**  
A: `null` = `Infinity` (default). Principals never expire by TTL, only evicted by LRU when capacity reached. This prevents spaced-burst bypass.

**Q: Why is `principal_extraction.mode="degraded"`?**  
A: `RL_CB_ENABLE=1` but `PRINCIPAL_HMAC_SECRET` not set. Per-principal CB disabled, global CB still active. Set secret to enable full functionality.

**Q: Are principals PII?**  
A: No. Principals are opaque HMAC-SHA256 hashes (base64url-encoded). No raw IPs, tokens, or user-agents are stored or exposed.

**Q: What's the difference between `open` and `half_open`?**  
A:
- **open**: Circuit tripped, all requests rejected (503)
- **half_open**: Cooldown elapsed, allowing probe requests to test recovery
- **closed**: Normal operation

**Q: How do I rotate `PRINCIPAL_HMAC_SECRET`?**  
A:
1. Generate new secret
2. Deploy with new secret
3. Principals will be re-keyed on next request
4. Old principals age out via LRU (no disruption)

**Q: Can I disable per-principal CB but keep global?**  
A: Yes. Don't set `PRINCIPAL_HMAC_SECRET` (degraded mode). Global CB remains active.

**Q: What's the expected principal churn rate?**  
A: Depends on traffic diversity. Typical: 100-500 unique principals/hour. Monitor `principals.tracked` in health.

**Q: Why did `TRUST_PROXY=1` change principal keys?**  
A: Canonical remote address changed (now using `X-Forwarded-For`). Principals are derived from remote address, so keys differ. This is expected.

**Q: How do I identify which principal is tripping circuits?**  
A: Principals are opaque HMACs. Correlate via request logs (timestamp, route, status) to identify patterns. Use perimeter logs for source IPs.

---

### Zero-PII Guarantees

**What's Protected:**
- ✅ No raw IP addresses in health/metrics
- ✅ No raw user-agents in health/metrics
- ✅ No raw auth tokens/user IDs in health/metrics
- ✅ Principals are opaque HMAC-SHA256 hashes

**What's Logged (Safe):**
- Circuit state transitions (timestamps, states, reasons)
- Aggregate counts (failures, successes, probes)
- Opaque principal identifiers (HMAC hashes)

**Verification:**
```bash
# Spot-check health for PII
curl -s http://localhost:3000/v1/health | grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}|Mozilla|Chrome|user-'
# Should return: no matches

# Spot-check metrics for PII
curl -s http://localhost:3000/metrics | grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}|Mozilla|Chrome|user-'
# Should return: no matches
```

---

### Performance Impact

**Expected Overhead:**
- Principal extraction: <0.5ms p95
- Circuit checks: <0.1ms p95 (in-memory)
- Total: <1ms p95 added latency

**Monitoring:**
```bash
# Check engine latency (should be unchanged)
curl -s http://localhost:3000/v1/health | jq '.engine_p95_ms'

# Check request duration histogram
curl -s http://localhost:3000/metrics | grep request_duration_seconds
```

**If Degraded Performance:**
- Check `principals.tracked` vs `capacity` (LRU eviction churn)
- Consider increasing `RL_CB_MAX_PRINCIPALS` (default: 1000)
- Verify no memory leaks (RSS should be stable)

---

