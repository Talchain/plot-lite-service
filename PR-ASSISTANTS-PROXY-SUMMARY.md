# Assistants Proxy Implementation Summary

## Overview

Successfully converted the in-process Assistants implementation into a **thin proxy layer** that forwards requests to the standalone `olumi-assistants-service`. This maintains the same API surface while moving all LLM logic out of the engine.

## What Changed

### ✅ Added

**Proxy Infrastructure** (`src/assist/proxy/`):
- **config.ts**: Centralized configuration with boot-time validation
  - Validates `ASSISTANTS_BASE_URL` when enabled
  - Enforces numeric limits (timeouts, retries, payload sizes)
  - Non-blocking upstream health checks (60s cache)

- **client.ts**: HTTP client with retry logic
  - Jittered exponential backoff for 5xx errors
  - Configurable timeouts and retry counts
  - Structured telemetry for all requests

- **guard.ts**: Shared safety rails for JSON + SSE
  - Request/response size limits (≤1MB)
  - SSE duration and idle timeout caps
  - Engine validation post-proxy (non-blocking)

**Proxy Routes** (`src/assist/routes/`):
- **draft-graph.ts**: JSON + SSE proxies with guards
- **suggest-options.ts**: Options suggestion proxy
- **explain-diff.ts**: Graph diff explanation proxy

**Integration**:
- Updated `createServer.ts`:
  - Validates proxy config on boot (fail-fast if misconfigured)
  - Background health check for upstream status
  - Conditional route registration (`ASSISTANTS_ENABLED=1`)
  - Enhanced `/health` endpoint with upstream status

**Documentation**:
- **docs/assistants-proxy.md**: Comprehensive setup + troubleshooting guide

**Tests**:
- **tests/assist/proxy.disabled.test.ts**: Verifies 404 when disabled

### ❌ Removed

**In-Process LLM Code**:
- `src/assist/adapters/` (OpenAI, Anthropic, router, types)
- `src/assist/services/` (pipeline, clarifier, repair)
- Old `.js` route files

**Dependencies** (can be removed):
- `openai` package (no longer needed in engine)
- `@anthropic-ai/sdk` package (no longer needed in engine)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ASSISTANTS_ENABLED` | No | `0` | Enable proxy routes |
| `ASSISTANTS_BASE_URL` | **Yes** (when enabled) | - | Upstream service URL |
| `ASSISTANTS_TIMEOUT_MS` | No | `12000` | JSON request timeout |
| `ASSISTANTS_SSE_TIMEOUT_MS` | No | `20000` | SSE stream timeout |
| `ASSISTANTS_MAX_RESPONSE_BYTES` | No | `1000000` | Max response size (1MB) |
| `ASSISTANTS_RETRIES` | No | `1` | Retry count for 5xx |

## How to Verify

### 1. Build succeeds

```bash
pnpm build
# Should compile with no errors
```

### 2. With proxy disabled

```bash
export ASSISTANTS_ENABLED=0
pnpm dev

curl http://localhost:4311/health | jq '.assistants_enabled'
# Should show: false

curl -X POST http://localhost:4311/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{"brief":"test"}'
# Should return: 404
```

### 3. With proxy enabled (requires upstream)

```bash
# Terminal 1: Start upstream assistants service
cd /path/to/olumi-assistants-service
pnpm dev  # Runs on http://localhost:3107

# Terminal 2: Start engine with proxy
cd /path/to/plot-lite-service
export ASSISTANTS_ENABLED=1
export ASSISTANTS_BASE_URL=http://localhost:3107
pnpm dev

curl http://localhost:4311/health | jq
# Should show:
# {
#   "assistants_enabled": true,
#   "assistants_base_url": "http://localhost:3107",
#   "assistants_upstream_status": "ok",
#   "assistants_last_checked_ms": 1234567890
# }

curl -X POST http://localhost:4311/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Should we expand or focus?"}' | jq
# Should proxy to upstream and return draft graph
```

## Safety Rails (Parity Achieved)

Both JSON and SSE routes enforce the same guards:

✅ **Request Guards**:
- Payload ≤1MB (413 if exceeded)
- Brief required, non-empty, ≤5000 chars
- Docs ≤10 files, ≤5k chars each

✅ **Response Guards**:
- Response ≤1MB
- Engine validation runs post-proxy (adds `validation_issues` if found)
- Provenance format preserved

✅ **SSE-Specific Guards**:
- Duration ≤`ASSISTANTS_SSE_TIMEOUT_MS`
- Idle timeout after 10s no data
- Bytes ≤`ASSISTANTS_MAX_RESPONSE_BYTES`
- Clean abort with error event if caps hit

## Telemetry Events

```
assist.proxy.request        - Request start
assist.proxy.response       - Response (includes latency, retried, bytes, cost_usd)
assist.proxy.sse_start      - SSE stream started
assist.proxy.sse_complete   - SSE stream finished (bytes, durationMs)
assist.proxy.sse_abort      - SSE stream aborted (reason)
assist.proxy.validation     - Engine validation found issues
```

## Error Handling

- **5xx errors**: Retry once with jittered backoff (100-1000ms)
- **Network errors**: Retry once
- **Timeouts**: No retry (fail immediately)
- **SSE failures**: No mid-stream retry (clean abort)

Error responses use consistent envelope:
```json
{
  "error": {
    "type": "BAD_INPUT|TIMEOUT|UPSTREAM_ERROR|...",
    "message": "..."
  }
}
```

## Architecture

**Before (In-Process)**:
```
Engine → LLM Adapters → OpenAI/Anthropic APIs
       → Clarifier
       → Document Parsing
```

**After (Proxy)**:
```
Engine → Proxy Layer → Assistants Service → LLM APIs
       ↓ Guards              ↓ Clarifier
       ↓ Validation          ↓ Doc Parsing
       ↓ Telemetry           ↓ Stability
```

**Benefits**:
- ✅ Independent scaling (assistants can scale separately)
- ✅ Independent deployment (no engine downtime for LLM changes)
- ✅ Cost isolation (LLM costs tracked in assistants service)
- ✅ Clean testing (engine tests don't need API keys)
- ✅ Preserved API surface (no breaking changes for clients)

## Testing Status

✅ **Build**: Compiles with no TypeScript errors
✅ **Unit Tests**: Proxy disabled test created
🔄 **Integration Tests**: Require mock or real upstream service

**Tests Pass Without Secrets**:
- Proxy disabled test (no API keys needed)
- Can add nock/fetch mocks for upstream responses

## Migration Checklist

### For Deployment

- [ ] Set `ASSISTANTS_ENABLED=1`
- [ ] Set `ASSISTANTS_BASE_URL` (e.g., `https://olumi-assistants-service.onrender.com`)
- [ ] Verify `/health` shows `assistants_enabled: true`
- [ ] Test `/assist/draft-graph` endpoint
- [ ] Monitor `assist.proxy.*` telemetry events

### Optional Cleanup

- [ ] Remove `openai` dependency from `package.json`
- [ ] Remove `@anthropic-ai/sdk` dependency from `package.json`
- [ ] Update CI to not require `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`

## Acceptance Criteria Status

✅ Engine boots with `ASSISTANTS_ENABLED=1` and valid `ASSISTANTS_BASE_URL`
✅ With `ASSISTANTS_ENABLED=0`, all `/assist/*` routes return 404
✅ Guards apply equally to JSON and SSE routes
✅ Engine validation runs after JSON draft responses (non-blocking)
✅ Telemetry includes upstream latency, status, cost fields
✅ No in-process LLM adapters remain in engine repo
✅ Build succeeds with no TypeScript errors
✅ Documentation created with setup and troubleshooting

## Next Steps

1. **Deploy**: Set env vars in production and verify proxy works
2. **Monitor**: Watch `assist.proxy.*` logs for latency/errors
3. **Iterate**: Add circuit breaker or concurrency limits if needed
4. **Test**: Create comprehensive integration tests with mock upstream

## Files Changed

**Added** (~1500 lines):
- `src/assist/proxy/config.ts`
- `src/assist/proxy/client.ts`
- `src/assist/proxy/guard.ts`
- `src/assist/routes/draft-graph.ts`
- `src/assist/routes/suggest-options.ts`
- `src/assist/routes/explain-diff.ts`
- `src/trust/validator.d.ts`
- `docs/assistants-proxy.md`
- `tests/assist/proxy.disabled.test.ts`

**Modified**:
- `src/createServer.ts` (added proxy config validation, route registration, health status)

**Removed** (~2000 lines):
- `src/assist/adapters/**` (OpenAI, Anthropic, router, types)
- `src/assist/services/**` (pipeline, clarifier, repair)
- `src/assist/routes/*.js` (old route files)

**Net Change**: Reduced complexity, cleaner separation of concerns

## Questions or Issues?

See [docs/assistants-proxy.md](./docs/assistants-proxy.md) for comprehensive troubleshooting guide.
