# Replay telemetry quick reference

- Health payload: see README “Replay telemetry (tests & local runs)”
- Test-only routes (enabled in tests via TEST_ROUTES=1; 404 in production):
  - GET /internal/replay-status → returns the replay snapshot
  - POST /internal/replay-report → increments refusal/retry counters and updates status
- Tools wiring:
  - tools/replay-fixtures.* reports { retry:true }, { refusal:true }, and final { status:"ok"|"fail" }
- Artifacts:
  - reports/tests.json (Vitest JSON)
  - reports/warp/* (replay logs, PR verify logs, profiler output if enabled)

## How to validate locally

1. Build
   - `npm run build`
2. Strict test suite (CI parity)
   - `RUN_REPLAY_STRICT=1 npm test`
3. Fast/local
   - `npm test`
4. Inspect telemetry
   - `curl -s "$TEST_BASE_URL/health" | jq '.replay'`
