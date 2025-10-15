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

## Prometheus /metrics Usage (C4)

**When**: `PROMETHEUS_ENABLE=1` exposes `/metrics` endpoint.

**Key Gauges**:
- `engine_p95_ms`: Current engine P95 latency
- `engine_p95_ms_rolling`: Rolling P95 (5min window)
- `json_429_total`: Total 429 responses (JSON endpoints)
- `sse_429_total`: Total 429 responses (SSE endpoint)
- `idem_cache_size`: Current idempotency cache size

**Quick Check**:
```bash
curl http://localhost:3000/metrics | grep engine_p95
```

**Grafana Query** (PromQL):
```
rate(json_429_total[5m])  # 429 rate per second
```

**Security**: Keep `PROMETHEUS_ENABLE=0` in production unless scraping via internal network.

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

## Escalation

If triage steps don't resolve:
1. Collect evidence pack: `npm run pack:build`
2. Attach logs with `reqId` correlation
3. Include `/v1/health` snapshot
4. Tag @eng-platform in incident channel
