# Contributing

## Test workflow (strict vs. local-friendly)

- Strict / CI-like: `npm test`
  Fails if any phase fails (Vitest, replay fixtures, OpenAPI check).
- Local-friendly: `npm run test:fast`
  Same as strict, but replay is non-fatal (`RUN_REPLAY_STRICT=0`). Failures still
  produce an artifact for inspection.

Artifacts:
- Replay failure payload: `reports/warp/replay-last.json`
- Vitest JSON: `reports/tests.json`

## Fuzz + trace repro (when fuzz fails in CI)
- CI attaches a repro bundle under the PR’s artifacts. Download it and run:
  - `npm run build`
  - `RUN_REPLAY_STRICT=1 node tools/run-all-tests.js`
- Inspect `reports/warp/*` for the last failing case and `reports/tests.json` for the test summary.

## Using the test server base URL
- All tools respect `TEST_BASE_URL` (e.g., `http://127.0.0.1:4313`) so the runner and validators hit the same instance.
