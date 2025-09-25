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

## Replay artifact schema (reports/warp/replay-last.json)
A minimal JSON payload saved when the replay step fails (always in CI; non-strict locally when using `npm run test:fast`).

Schema (informal):
- base: string
  - The base URL used for HTTP calls during the test run (e.g., `http://127.0.0.1:4313`).
- code: number
  - The process exit code from the replay script.
- stdout: string
  - Tail (last ~2000 chars) of stdout from the replay step.
- stderr: string
  - Tail (last ~2000 chars) of stderr from the replay step.

Notes:
- These tails are intended for quick triage; the failing seed/case is typically visible in stdout.
- CI uploads this file under the `warp-artifacts*` artifact. Locally, find it at `reports/warp/replay-last.json`.
