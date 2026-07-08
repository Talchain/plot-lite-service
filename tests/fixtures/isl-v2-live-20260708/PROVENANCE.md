# ISL V2 live capture — 2026-07-08 (build 3773f76)

Raw request/response pair captured from **isl-staging** for lane 29
(`claude-lane29/v2-read-residuals`), re-verifying the wire generation
against the then-deployed ISL build per PLOT-V2-READ-FIX-SPEC.md §3.2
(the 20260707 fixture was captured from build `9a22a1a`; the deployed
build had since moved to `3773f76151a0b5ee9d286ef4d12e3b872877ff5c`,
verified via `/health` at capture time, 2026-07-08T01:06Z).

## Capture method

One authenticated `POST` to
`https://isl-staging.onrender.com/api/v1/robustness/analyze/v2?response_version=2`
with headers `Content-Type: application/json`, `X-ISL-Response-Version: 2`,
and `X-API-Key` (fetched read-only from the isl-staging Render env var
`ISL_API_KEYS` at capture time; never stored, never committed). No staging
scenario rows involved (direct ISL compute call on the synthetic graph —
the reserved scenarios were not touched).

## Files

| File | What |
|---|---|
| `isl-v2-request.json` | **Byte-identical** (`cmp` verified) to `tests/fixtures/isl-v2-live-20260707/isl-v2-request.json` and `tests/fixtures/isl-v2-live-20260706/isl-v2-request.json` — same synthetic hiring-decision graph, seed `2034401427`, `n_samples` 4000. Re-run unchanged so the only variable is the deployed ISL build. |
| `isl-staging-capture.json` | Live response to the above. Wire shape UNCHANGED vs the 20260707 capture (build 9a22a1a): identical top-level key set (22 keys), identical `robustness` key set, nested `robustness.edge_e_values` (13 entries) + `robustness.edge_sensitivity` (26 entries), top-level `factor_evpi` (4), `timestamp`, `sensitivity_reference_option_id` (`"opt_one_dev"`); no V1-era fields (`validation_status` / top-level `sensitivity` / top-level `edge_e_values` / `computed_at` all absent). |

## Sanitisation

Scanned for emails / IPs / key-like strings (`api[_-]?key|secret|token|password`)
— none present. Graph data is the same synthetic hiring-decision demo as the
20260706/20260707 fixture sets.

## Consumers

- `tests/contract/isl-to-plot.contract.test.ts` — parameterised over the
  20260707 AND 20260708 captures (same assertions per capture).
- `tests/isl-wire-generation.unit.test.ts` — asserts
  `assessIslWireGeneration` verifies this envelope (build `3773f76`).
