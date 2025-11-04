# Assistants Proxy

The PLoT engine includes a thin proxy layer for the standalone **olumi-assistants-service**. All LLM-based decision graph drafting, option suggestion, and diff explanation logic lives in the standalone service. The engine simply forwards requests and enforces consistent safety rails.

## Quick Start

### 1. Enable the proxy

```bash
export ASSISTANTS_ENABLED=1
export ASSISTANTS_BASE_URL=https://olumi-assistants-service.onrender.com
```

### 2. Start the engine

```bash
pnpm dev
```

### 3. Verify health

```bash
curl http://localhost:4311/health | jq
# Should show:
# {
#   "assistants_enabled": true,
#   "assistants_base_url": "https://...",
#   "assistants_upstream_status": "ok|degraded|down",
#   "assistants_last_checked_ms": 1234567890
# }
```

### 4. Draft a graph

```bash
curl -X POST http://localhost:4311/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Should we expand internationally or focus on domestic growth?"}'
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ASSISTANTS_ENABLED` | No | `0` | Set to `1` to enable proxy routes |
| `ASSISTANTS_BASE_URL` | **Yes** (when enabled) | - | Base URL of assistants service (e.g., `https://olumi-assistants-service.onrender.com`) |
| `ASSISTANTS_TIMEOUT_MS` | No | `12000` | Timeout for JSON requests (1000-60000ms) |
| `ASSISTANTS_SSE_TIMEOUT_MS` | No | `20000` | Timeout for SSE streams (1000-120000ms) |
| `ASSISTANTS_MAX_RESPONSE_BYTES` | No | `1000000` | Max response size (10k-10MB) |
| `ASSISTANTS_RETRIES` | No | `1` | Number of retries for 5xx errors (0-3) |

## Routes

All `/assist/*` routes are registered conditionally when `ASSISTANTS_ENABLED=1`:

### POST /assist/draft-graph

Draft a decision graph from a brief (JSON).

**Request:**
```json
{
  "brief": "Should we hire full-time or use contractors?",
  "seed": 17,
  "docs": []
}
```

**Response:**
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "rationales": [...],
  "confidence": 0.85,
  "cost_usd": 0.0042,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "validation_issues": [...]  // Only present if engine validation found issues
}
```

### POST /assist/draft-graph/stream

Draft a decision graph with SSE streaming (shows progress).

**Events:**
- `stage`: `{ "stage": "DRAFTING" }`
- `complete`: `{ "graph": {...}, "cost_usd": 0.0042 }`
- `error`: `{ "error": { "type": "...", "message": "..." } }`

### POST /assist/suggest-options

Get 3-5 strategic options for a goal.

**Request:**
```json
{
  "goal": "Reduce operational costs by 20%",
  "constraints": { "timeline": "Q1 2024" },
  "existingOptions": ["Automate manual processes"]
}
```

**Response:**
```json
{
  "options": [
    {
      "id": "opt_a",
      "title": "Implement automation",
      "pros": ["Fast ROI", "Scalable"],
      "cons": ["Upfront cost"],
      "evidence_to_gather": ["Current manual hours", "Automation tool costs"]
    }
  ],
  "cost_usd": 0.0021,
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

### POST /assist/explain-diff

Explain differences between two graphs.

**Request:**
```json
{
  "before": { "nodes": [...], "edges": [...] },
  "after": { "nodes": [...], "edges": [...] },
  "context": "User added more options"
}
```

**Response:**
```json
{
  "changes": [
    {
      "change_type": "node_added",
      "target_id": "opt_new",
      "explanation": "Added new option to explore alternative paths",
      "provenance": { "source": "brief" }
    }
  ],
  "cost_usd": 0.0015
}
```

## Safety Rails

The proxy enforces consistent guardrails for both JSON and SSE routes:

### Request Guards
- **Payload limit**: ≤1MB (413 if exceeded)
- **Brief validation**: Required, non-empty, ≤5000 chars
- **Docs limit**: ≤10 docs, ≤5k chars each

### Response Guards (JSON + SSE Parity)
- **Size limit**: ≤1MB (413 if exceeded)
- **Node/edge caps**: ≤12 nodes, ≤24 edges (400 if exceeded)
- **Cost presence**: Draft responses must include `cost_usd` (400 if missing)
- **Engine validation**: After receiving draft graph, runs engine validator and includes `validation_issues` if found (non-blocking)
- **Provenance preservation**: Maintains format for engine compatibility

**Both JSON and SSE routes enforce identical guards** - no drift between paths.

### SSE-Specific Guards
- **Duration cap**: ≤`ASSISTANTS_SSE_TIMEOUT_MS` (default 20s)
- **Idle timeout**: Aborts if no chunks for 10s
- **Bytes cap**: ≤`ASSISTANTS_MAX_RESPONSE_BYTES` (default 1MB)

## Retries & Error Handling

- **5xx errors**: Retries once with jittered backoff (100-1000ms)
- **Network errors**: Retries once
- **Timeouts**: No retry (fails immediately)
- **SSE failures**: No mid-stream retry (clean abort with error event)

## Telemetry

The proxy emits structured logs for observability. **All telemetry events include `provider` and `cost_usd` fields** with fallbacks (`"unknown"` and `0` respectively) when upstream doesn't provide them.

### JSON Request Events
```
assist.proxy.request  - Request start
assist.proxy.response - Request complete (includes status, latency, retried, bytes, provider, cost_usd, model)
```

### SSE Stream Events
```
assist.proxy.sse_start    - Stream started
assist.proxy.sse_complete - Stream finished (includes bytes, durationMs)
assist.proxy.sse_abort    - Stream aborted (includes reason)
```

### Error Events
```
assist.proxy.validation - Engine validation found issues
```

## Health Checks

The `/health` endpoint includes upstream status:

```json
{
  "assistants_enabled": true,
  "assistants_base_url": "https://...",
  "assistants_upstream_status": "ok",  // "ok" | "degraded" | "down"
  "assistants_last_checked_ms": 1234567890
}
```

**Upstream check:**
- Runs on boot (non-blocking)
- Cached for 60s
- Lightweight HEAD/GET request with 100ms timeout
- Does not block engine startup if upstream is down

## Troubleshooting

### "ASSISTANTS_ENABLED=1 requires ASSISTANTS_BASE_URL"

**Cause**: Proxy enabled but base URL not set
**Fix**: Set `ASSISTANTS_BASE_URL` environment variable

```bash
export ASSISTANTS_BASE_URL=https://olumi-assistants-service.onrender.com
```

### 502 Bad Gateway

**Cause**: Upstream service unreachable or timing out
**Check**: Verify upstream is running:

```bash
curl -I $ASSISTANTS_BASE_URL/health
```

**Check logs** for `UPSTREAM_FAILURE` errors with retry info.

### 413 Payload Too Large

**Cause**: Request or response exceeds 1MB
**Fix**: Reduce payload size (trim docs, shorten brief)

### SSE stream aborts with "idle" reason

**Cause**: No data from upstream for >10s
**Check**: Upstream service logs for stalls

### "validation_issues" in response

**Info**: Engine validator found issues but didn't block the request
**Action**: Review `validation_issues` array; upstream graph may violate engine constraints (e.g., cycles, missing nodes)

### Graph exceeds 12 nodes or 24 edges

**Cause**: Upstream returned a graph violating v04 spec caps
**Error**: `400 Bad Request` with `VALIDATION_FAILED` type
**Fix**: This indicates the upstream service isn't respecting caps; check upstream configuration

**Note**: Both JSON and SSE routes enforce identical caps - no drift between paths

## Deployment

### Render (Production)

Add to your engine service environment variables:

```
ASSISTANTS_ENABLED=1
ASSISTANTS_BASE_URL=https://olumi-assistants-service.onrender.com
ASSISTANTS_TIMEOUT_MS=15000
ASSISTANTS_SSE_TIMEOUT_MS=30000
```

### Local Development

```bash
# Terminal 1: Start assistants service
cd olumi-assistants-service
pnpm dev  # Runs on http://localhost:3107

# Terminal 2: Start engine with proxy
cd plot-lite-service
export ASSISTANTS_ENABLED=1
export ASSISTANTS_BASE_URL=http://localhost:3107
pnpm dev  # Runs on http://localhost:4311
```

## Testing

All tests pass without secrets (use mock upstream):

```bash
# Test with proxy disabled
ASSISTANTS_ENABLED=0 pnpm test tests/assist/proxy.disabled.test.ts

# Test with proxy enabled (requires mock or real upstream)
ASSISTANTS_ENABLED=1 ASSISTANTS_BASE_URL=http://localhost:3107 pnpm test
```

## Architecture

```
┌─────────────────┐
│  PLoT Engine    │
│  (This Repo)    │
│                 │
│  /assist/*      │  ← Thin proxy layer
│  - Guards       │
│  - Validation   │
│  - Telemetry    │
└────────┬────────┘
         │ HTTP/SSE
         ↓
┌─────────────────┐
│  Assistants     │
│  Service        │
│                 │
│  - OpenAI       │
│  - Anthropic    │
│  - Clarifier    │
│  - Doc Parsing  │
│  - Stability    │
└─────────────────┘
```

**Separation of concerns:**
- **Engine**: Graph execution, causal inference, validation
- **Assistants**: LLM orchestration, drafting, clarification

**Benefits:**
- Independent scaling (assistants can scale separately)
- Independent deployment (no engine downtime for LLM changes)
- Cost isolation (LLM costs tracked in assistants service)
- Clean testing (engine tests don't need API keys)

## Migration from In-Process

The previous implementation ran LLM adapters in-process. The proxy replaces this with:

**Removed:**
- `src/assist/adapters/**` (OpenAI, Anthropic adapters)
- `src/assist/services/**` (Pipeline, clarifier, repair logic)
- In-process LLM dependencies

**Added:**
- `src/assist/proxy/` (Client, config, guard)
- Upstream health checking
- Retry logic with jittered backoff
- Consistent guards for JSON + SSE

**Preserved:**
- Same API surface (`/assist/*` routes)
- Same response schemas
- Same feature flag (`ASSISTANTS_ENABLED`)
- Graph schemas and fixtures

## FAQ

### Q: Can I disable the proxy?

**A**: Yes, set `ASSISTANTS_ENABLED=0`. All `/assist/*` routes will 404.

### Q: What happens if upstream is down?

**A**: Requests return 502 with `UPSTREAM_FAILURE` error. Engine continues serving `/v1/run` normally.

### Q: Does the proxy modify responses?

**A**: Minimal changes:
- Adds `validation_issues` if engine validator finds problems
- Passes through upstream cost/provider tags
- Does **not** modify graph structure

### Q: How do I monitor proxy performance?

**A**: Check logs for `assist.proxy.*` events. Key metrics:
- `latencyMs` (upstream response time)
- `retried` (was request retried?)
- `cost_usd` (LLM cost)
- `bytes` (response size)

### Q: Can I use a different assistants service?

**A**: Yes! Set `ASSISTANTS_BASE_URL` to any compatible service that implements the same `/assist/*` API contracts.

## See Also

- [Assistants Service README](https://github.com/olumi/olumi-assistants-service)
- [Engine API Reference](./api.md)
- [Performance Testing](../Docs/performance-testing.md)
