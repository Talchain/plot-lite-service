# Backend P0 Unblock: LIVE ✅

**Production URL:** https://plot-lite-service.onrender.com  
**PR:** https://github.com/Talchain/plot-lite-service/pull/69

---

## What's Available Now

### 1. result.response_hash
All `/v1/run` responses now include a deterministic SHA-256 hash:
```json
{
  "result": {
    "response_hash": "68bad0aa879b3e01b67c746b5c29f2721b37b4632d6feb048f01db3c6239250f",
    "summary": {...},
    ...
  }
}
```

### 2. GET /v1/limits
Returns configured graph size limits:
```bash
curl https://plot-lite-service.onrender.com/v1/limits
```
```json
{
  "nodes": {"max": 200},
  "edges": {"max": 500}
}
```

### 3. POST /v1/validate
Pre-flight validation for graph payloads:
```bash
curl -X POST https://plot-lite-service.onrender.com/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{"graph": {...}}'
```
```json
{
  "valid": true,
  "violations": []
}
```

### 4. Strict Shape Enforcement
API now validates edge format. **Required fields:**
```json
{
  "from": "string",      // Required
  "to": "string",        // Required
  "weight": number,      // Required
  "label": "string",     // Required
  "body": "string",      // Required
  "belief": number,      // Optional (0-1)
  "provenance": "string" // Optional
}
```

**Rejected fields (will cause 400 error):**
- ❌ `source` (use `from` instead)
- ❌ `target` (use `to` instead)
- ❌ `position` (not supported)
- ❌ nested `data` object (flatten to top-level)
- ❌ `type` (not supported)

---

## Determinism Verified

Two identical calls to `/v1/run` with the same graph and seed produce identical `result.response_hash` values. This enables:
- Caching
- Deduplication
- Idempotency checks

---

## Debug Features

`debug.inspector` and `debug.compare` slices remain behind feature flags and are **OFF by default** in production. These are for internal debugging only and not part of the UI contract.

---

## Integration Notes

1. **Use /v1/validate** before /v1/run for better UX (catch errors early)
2. **Check /v1/limits** to enforce client-side graph size limits
3. **Store response_hash** for caching/deduplication
4. **Enforce edge shape** in UI editor (reject source/target/position/type fields)

---

## Questions or Issues?

- API docs: `/v1/openapi.json` (when `OPENAPI_DEV=1`)
- Health check: `/v1/health`
- GitHub issues: https://github.com/Talchain/plot-lite-service/issues

**Status:** Ready for UI integration ✅
