# Diagnostics and Evidence Pack

This document explains how to run the one-command diagnostics, what outputs to expect, and how to quickly triage failures.

## One-command diagnostics

Run:

```bash
npm run diag
```

This performs:
- typecheck
- full unit tests
- self-start Evidence Pack generation
- CI assertions (contracts/perf/health/head parity)
- prints: latest pack path, `pack-summary.json`, and the tail of `engine/selfstart.log`

## Expected outputs
- A line like: `GATES: PASS — p95=<X>ms; sse, health, head-parity[, rate-limit] OK`.
- Latest pack path: `artifact/Evidence-Pack-YYYYMMDD-HHMM/`
- `pack-summary.json` in that directory
- `engine/access-log-snippet.txt` (20 lines, no payloads/queries)

## Common failure messages
- Example consolidated FAIL (see per-gate lines for details):
  - `FAIL | p95_ms=... (budget <= 600)` and `GATE ...: FAIL — ...`
- `ci-assert: No Evidence Pack found ...` (exit 2)
  - Cause: Evidence Pack not generated. Re-run with: `PACK_SELF_START=1 bash tools/verify-and-pack.sh`.
- `GATE p95: FAIL — p95_ms=... > budget=600`
  - Check `reports/loadcheck.json` in the latest pack.
- `GATE sse_enum: FAIL — got=... want=...`
  - Ensure `contracts/sse-event.schema.json` matches the frozen event set.
- `GATE health_keys: FAIL — missing: ...`
  - The captured `engine/health.json` is missing required keys.
- `GATE head_parity: FAIL — diffs=...`
  - Compare `engine/head-200.h` vs `engine/draft-flows-200.h`.
- `self-start failed to become ready ... within 10s (exit 3)`
  - Investigate `engine/selfstart.log` tail printed by the script.

## Fetch latest Evidence Pack path

```bash
node tools/pack-locate.mjs
```

Prints the absolute path, or `<none>` if no packs exist.

## Slack triage block (copy/paste)

```bash
node -v && npm -v
npm run typecheck || true
npm test || true
PACK_SELF_START=1 bash tools/verify-and-pack.sh || true
node tools/ci-assert.mjs || true
PACK_PATH=$(node tools/pack-locate.mjs)
echo "Latest pack: ${PACK_PATH}"
[ -n "$PACK_PATH" ] && cat "$PACK_PATH/pack-summary.json" || true
[ -n "$PACK_PATH" ] && tail -n 120 "$PACK_PATH/engine/selfstart.log" || true
```

## Notes
- Set `PACK_RETAIN_N` to control how many packs are kept (default 7; recommended max 20).
- No production defaults are changed; features remain gated.
- Retryable stream errors are test-routes only (`/stream?fail=RETRYABLE` requires `TEST_ROUTES=1`).
