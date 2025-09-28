# PLoT-lite SDKs

Add-only, gated SDK stubs for Node and Python to interact with the engine test routes.

- Test routes require `TEST_ROUTES=1` (do not use in production).
- Rate limit is disabled in examples (`RATE_LIMIT_ENABLED=0`).

## Node SDK

- Source: `sdk/node/index.ts`
- Example: `sdk/node/example.ts`

Features:
- Async SSE parsing using Node 20 `fetch` streams
- `openStream({ url, id, lastEventId, onEvent, onError })`
- `iterateStream({ url, id, lastEventId })` async iterator
- Idempotent cancel via returned controller
- Resume using `Last-Event-ID`

Run example against a temporary test server:

```bash
npm run build
TEST_PORT=4390 TEST_ROUTES=1 RATE_LIMIT_ENABLED=0 node tools/test-server.js &
node sdk/node/example.js
```

## Python SDK

- Source: `sdk/python/client.py`
- Example: `sdk/python/example.py`

Features:
- Minimal SSE reader using stdlib `http.client`
- Cancel + resume using `Last-Event-ID`

Run example (ensure test server is running as above):

```bash
python3 sdk/python/example.py
```

## Checksum Guard (seed 4242)

- Test: `tests/sdk.checksum.guard.test.ts`
- Starts a test server, fetches `/draft-flows?template=pricing_change&seed=4242`, and compares `sha256` to the fixture bytes.
- Fails if bytes drift.

## Env flags

- `TEST_ROUTES=1` enable test-only routes (`/stream`, `/stream/cancel`, etc.)
- `RATE_LIMIT_ENABLED=0` disable rate limiting for examples/tests
- `CORS_DEV=1` allow browser dev origin (optional)
