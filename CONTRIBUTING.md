# Contributing

## Testing

We use a small test orchestrator that brings up a local test server (with test-only routes) and runs the suite.

- Strict (CI parity)
  1. `npm run build`
  2. `RUN_REPLAY_STRICT=1 npm test`

- Fast/local
  1. `npm run build`
  2. `npm test`

Notes
- TEST_BASE_URL is propagated by the test orchestrator; you usually don’t need to set it.
- Test-only endpoints are gated by TEST_ROUTES=1 (enabled by the test server helper). In production these routes return 404.
- Keep-alive agents and health gates are handled by the test runner; avoid adding extra sleeps in tests.
- Artifacts are written to:
  - `reports/tests.json` (Vitest JSON)
  - `reports/warp/` (local PR verify logs and related artefacts)

## Replay telemetry

- GET `/health` includes `replay` with fields:
  - `lastStatus`: outcome of the last replayed flow (ok or fail)
  - `refusals`: number of connection refusals observed by the replay harness
  - `retries`: number of retry attempts by the harness
  - `lastTs`: ISO timestamp of the latest update
- Test-only endpoints (enabled in tests via TEST_ROUTES=1; 404 in production):
  - GET `/internal/replay-status` → the replay snapshot
  - POST `/internal/replay-report` → increments counters and records status
- The replay tool (tools/replay-fixtures.*) posts `{retry:true}`, `{refusal:true}`, and a terminal `{status:"ok"|"fail"}`.
