# ISL V2 live capture — 2026-07-07 (build 9a22a1a)

Raw request/response pairs captured from **isl-staging** for lane
PLoT-W4 (`claude-lane13/edge-sensitivity-consumption`), consuming the new
V2 wire fields produced by ISL lane 11 (ISL PR #65, deployed build
`9a22a1ae025551eb08cf6526c88507573bc2923c`, verified via `/health` at
capture time).

## Capture method

One authenticated `POST` per pair to
`https://isl-staging.onrender.com/api/v1/robustness/analyze/v2?response_version=2`
with headers `Content-Type: application/json`, `X-ISL-Response-Version: 2`,
and `X-API-Key` (fetched read-only from the isl-staging Render env var
`ISL_API_KEYS` at capture time; never stored, never committed).

## Files

| File | What |
|---|---|
| `isl-v2-request.json` | **Byte-identical** to `tests/fixtures/isl-v2-live-20260706/isl-v2-request.json` (capture A of the earlier lane — same synthetic hiring-decision graph, seed `2034401427`, `n_samples` 4000). Re-run unchanged so the only variable is the deployed ISL build. |
| `isl-staging-capture.json` | Live response to the above. NEW vs the 20260706 capture: `robustness.edge_sensitivity` (26 entries, `EdgeSensitivityV2` shape) and top-level `sensitivity_reference_option_id` (`"opt_one_dev"`). No `path_decomposition` (not requested). |
| `isl-v2-request-pathdecomp.json` | Same body plus `"include_path_decomposition": true`. |
| `isl-staging-capture-pathdecomp.json` | Live response to the above. Additionally carries top-level `path_decomposition` (recommended_option_id `opt_tech_lead`, 2 entry nodes, `path_count` 6, top-3 `paths`, `truncated: false`). |

## Sanitisation

Scanned for IPs / emails / hostnames / key-like strings — none present.
Graph data is the same synthetic hiring-decision demo as the 20260706
fixture set.

## Relationship to `isl-v2-live-20260706/`

The 20260706 set (ISL build `f3f5d92`) is DELIBERATELY KEPT and still
drives the warning-path liveness test: on that older wire
`robustness.edge_sensitivity` is absent and PLoT must emit
`EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE`. This 20260707 set drives the
populated path: `edge_sensitivity` non-empty and the warning suppressed.
Never both absent.
