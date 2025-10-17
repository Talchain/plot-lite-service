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

## Escalation

If triage steps don't resolve:
1. Collect evidence pack: `npm run pack:build`
2. Attach logs with `reqId` correlation
3. Include `/v1/health` snapshot (including cache stats)
4. Include `/ops/snapshot` if available (redacted, safe to share)
5. Tag @eng-platform in incident channel
