# Production Deployment Checklist

This checklist covers deployment verification for the plot-lite-service (engine) with Assistants proxy enabled.

## Pre-Deployment

### 1. Environment Variables Verification

Ensure the following environment variables are set on Render:

#### Required
- `ASSISTANTS_ENABLED=1` - Enables the `/assist/*` proxy routes
- `ASSISTANTS_BASE_URL=https://<assistants-service-url>` - Points to the standalone assistants service
- `OPENAI_API_KEY=<key>` or `ANTHROPIC_API_KEY=<key>` - Provider credentials (set on assistants service)

#### Recommended
- `COST_MAX_USD=1.0` - Cost cap per request (default: $1.00)
- `ASSISTANTS_TIMEOUT_MS=12000` - JSON request timeout (default: 12s)
- `ASSISTANTS_SSE_TIMEOUT_MS=20000` - SSE stream duration cap (default: 20s)
- `ASSISTANTS_MAX_RESPONSE_BYTES=1000000` - Response size limit (default: 1MB)
- `ASSISTANTS_RETRIES=1` - Retry count for 5xx errors (default: 1)

#### CORS (if applicable)
- `ALLOWED_ORIGINS=https://your-frontend.com` - CORS allowlist

### 2. Build Verification

```bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service
pnpm install
pnpm typecheck
pnpm test
```

All tests must pass before deploying.

### 3. Assistants Service Health

Verify the standalone assistants service is deployed and healthy:

```bash
curl -I https://<assistants-service-url>/healthz
# Expected: 200 OK
```

## Post-Deployment Smoke Tests

### 4. Engine Health Check

```bash
curl https://<engine-url>/health | jq .
```

**Expected response**:
```json
{
  "status": "ok",
  "assistants_enabled": true,
  "assistants_base_url": "https://<assistants-service-url>",
  "assistants_upstream_status": "ok",
  "assistants_last_checked_ms": 1234567890
}
```

Verify:
- `assistants_enabled: true`
- `assistants_upstream_status: "ok"` (may be "degraded" initially, retry after 60s)

### 5. Draft Graph - JSON Route

Test the JSON endpoint with a simple brief:

```bash
curl -X POST https://<engine-url>/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief": "Help me decide whether to buy or lease a car"}' \
  | jq .
```

**Expected response** (example):
```json
{
  "graph": {
    "version": "1",
    "default_seed": 17,
    "nodes": [
      {"id": "g1", "kind": "goal", "label": "Buy vs Lease Decision"}
    ],
    "edges": [],
    "meta": {
      "roots": ["g1"],
      "leaves": ["g1"],
      "source": "assistant"
    }
  },
  "cost_usd": 0.0042,
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

**Verification**:
- Response contains `graph` with `nodes` and `edges`
- `nodes.length ≤ 12`
- `edges.length ≤ 24`
- `cost_usd` is present and numeric
- `provider` is present (e.g., "openai", "anthropic")

### 6. Draft Graph - SSE Route

Test the SSE streaming endpoint:

```bash
curl -X POST https://<engine-url>/assist/draft-graph/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"brief": "Help me decide whether to invest in stocks or bonds"}' \
  --no-buffer
```

**Expected output**:
```
event: stage
data: {"stage":"DRAFTING"}

event: complete
data: {"graph":{...},"cost_usd":0.0038,"provider":"openai"}
```

**Verification**:
- Stream begins with `event: stage`
- Stream ends with `event: complete` containing full graph
- No `event: error` emitted
- Complete event includes `cost_usd` and `provider`

### 7. Guard Enforcement Verification

Test that caps are enforced:

```bash
# This should fail if upstream tries to return too many nodes
curl -X POST https://<engine-url>/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief": "Create a detailed decision tree with 20 complex options"}' \
  | jq .
```

If upstream violates caps (>12 nodes or >24 edges):
- **JSON**: Returns `400 Bad Request` with `VALIDATION_FAILED`
- **SSE**: Emits `event: error` with `VALIDATION_FAILED`

### 8. Telemetry Verification

Check application logs (Render dashboard or `render logs <service-name>`):

```bash
render logs <engine-service-name> --tail 50
```

**Look for**:
- `assist.proxy.request` - Request start
- `assist.proxy.response` - JSON request complete (includes `provider`, `cost_usd`)
- `assist.proxy.sse_start` - SSE stream started
- `assist.proxy.sse_complete` - SSE stream finished (includes `provider`, `cost_usd`)

**Verify**:
- All logs include `provider` field (even if "unknown")
- All logs include `cost_usd` field (even if 0)

### 9. Error Handling Verification

Test error scenarios:

#### Upstream unavailable
```bash
# Temporarily set ASSISTANTS_BASE_URL to invalid URL and redeploy
# Or stop assistants service
curl -X POST https://<engine-url>/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief": "test"}' \
  | jq .
```

**Expected**: `502 Bad Gateway` with retry telemetry

#### Invalid input
```bash
curl -X POST https://<engine-url>/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief": ""}' \
  | jq .
```

**Expected**: `400 Bad Request` with `BAD_INPUT` type

### 10. Performance Baseline (Optional)

If you have performance testing setup:

```bash
export ASSISTANTS_URL=https://<engine-url>
cd /Users/paulslee/Documents/GitHub/plot-lite-service
pnpm perf:baseline:prod
```

**Target metrics**:
- p95 latency ≤ 8000ms (8 seconds)
- p99 latency ≤ 12000ms (12 seconds)
- Success rate ≥ 95%

Results are written to:
- `tests/perf/_reports/` (HTML report)
- `docs/baseline-performance-report.md` (Markdown summary)

## Rollback Procedure

If issues are detected post-deployment:

### Quick Disable
Set `ASSISTANTS_ENABLED=0` on Render and redeploy. This disables `/assist/*` routes immediately without code changes.

### Full Rollback
```bash
# Revert to previous deployment via Render dashboard
# Or git revert the merge commit
git revert <merge-commit-sha>
git push origin main
```

## Monitoring & Alerts (Future)

### Observability Setup
- Import Datadog dashboard from `observability/datadog-dashboard.json`
- Configure alerts for:
  - High error rate (>5% over 5min)
  - High p95 latency (>10s over 5min)
  - Cost anomalies (>$0.10 per request)

### Metrics to Track
- Request rate (`assist.proxy.request`)
- Success/error ratio
- p50, p95, p99 latency
- Cost per request distribution
- Provider distribution (openai vs anthropic)

## Acceptance Criteria

- [x] All environment variables set correctly
- [x] Health endpoint shows `assistants_enabled: true` and `assistants_upstream_status: "ok"`
- [x] JSON endpoint returns valid graphs with cost_usd
- [x] SSE endpoint streams events correctly
- [x] Guards enforce ≤12 nodes, ≤24 edges
- [x] Telemetry includes provider and cost_usd in all logs
- [x] Error handling works as expected
- [x] Performance meets baseline targets (if tested)

## Support

For issues or questions:
- Check logs: `render logs <service-name>`
- Review docs: `docs/assistants-proxy.md`
- Troubleshooting: See "Troubleshooting" section in `docs/assistants-proxy.md`
