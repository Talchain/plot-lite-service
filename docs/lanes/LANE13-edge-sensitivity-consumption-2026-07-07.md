# Lane PLoT-W4 (lane 13) evidence report — consume ISL V2 edge sensitivity + T1-5/T1-6 disclosures

- Date: 2026-07-07
- Branch: `claude-lane13/edge-sensitivity-consumption` (fresh worktree from `origin/staging` @ `85e06d7`)
- Producer side: ISL lane 11 (ISL PR #65), deployed on isl-staging as build
  `9a22a1ae025551eb08cf6526c88507573bc2923c` (verified via `/health` before capture).
- Contract status: **ADDITIVE ONLY** — no boundary field renamed, retyped, or removed.
  New request flag defaults off; new response fields are optional and absent unless the
  wire carried them.
- Doctrine: wording surfaces tagged `provisional_doctrine_v0` — the updated
  EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE message (diagnostic disclosure) and the
  passed-through ISL `interpretation` / `mechanism` strings (ISL-owned analyzer output,
  tagged at the type level; not new PLoT copy).

## Fixture provenance (FIRST ACTION, committed before any code change — `510d15d`)

`tests/fixtures/isl-v2-live-20260707/` — captured via one authenticated POST per pair to
`https://isl-staging.onrender.com/api/v1/robustness/analyze/v2?response_version=2`
(X-API-Key fetched read-only from the isl-staging Render env at capture time; never
stored, never printed, never committed). `isl-v2-request.json` is **byte-identical** to
the 20260706 capture-A request (machine-checked: `newRequest toEqual oldRequest`), so
the only variable between the two fixture generations is the deployed ISL build:

| Wire fact | f3f5d92 (20260706 fixture) | 9a22a1a (20260707 fixture) |
|---|---|---|
| `robustness.edge_sensitivity` | ABSENT | **26 `EdgeSensitivityV2` entries** |
| `sensitivity_reference_option_id` | ABSENT | **`"opt_one_dev"` (= `options[0].id`)** |
| `path_decomposition` (with `include_path_decomposition: true`) | n/a | **top-level, 6 paths enumerated, top-3 emitted, truncated=false** |
| `path_decomposition` (without the flag) | ABSENT | ABSENT (request-gated, confirmed live) |
| top-level `sensitivity` (V1-era) | ABSENT | ABSENT (still dead) |

Sanitisation scan (IPs/emails/hostnames/key-like strings): clean; same synthetic
hiring-decision graph as the 20260706 set. See the fixture dir's `PROVENANCE.md`.

## A. edge_sensitivity consumption (commit `3332986`)

- New accessor `getIslEdgeSensitivity` in `src/integrations/isl/v2-envelope.ts` —
  canonical nested read (`robustness.edge_sensitivity`), returns `undefined` when
  absent/empty so the warning path stays reachable on older deployed ISL. Deliberately
  NO fallback to the V1-era top-level `sensitivity` (different shape, verified dead on
  the live wire).
- `transformEdgeSensitivity` (run.ts) accepts both entry shapes (`from_id`/`to_id`
  live V2; `edge_from`/`edge_to` legacy fixtures). Existing numeric-egress guard kept;
  entries with unresolvable node IDs are dropped rather than emitting
  `undefined::undefined` ids. The V2-only `sensitivity_score`/`direction` wire fields
  are **not** emitted outward (public `EdgeSensitivityResultV3` shape unchanged —
  contracts frozen; direction is the elasticity sign, already carried).
- Wired at BOTH read sites: the main path (`buildResponse` pre-computed
  `sensitivityData`) and the `buildResponse` fallback path.
- `EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE`: **kept, now conditional in effect** — the
  emission was already gated on the final array being empty, so populating the array
  suppresses it with no new branching. Message updated to name the build threshold
  (tagged `provisional_doctrine_v0`). Invariant documented at the code, type, OpenAPI,
  and test levels: **populated OR marked, never both absent on a computed analysis.**

## B. sensitivity_reference_option_id (commit `3332986`)

Verbatim additive passthrough on the /v2/run response (disclosure; UI consumption is a
later lane). Emitted only when ISL disclosed a non-empty string — honest absence on
older builds; PLoT never invents a baseline. Excluded from response_hash by
construction (the hash canonicalises the request).

## C. path_decomposition (commit `3332986`)

- New /v2/run request flag `include_path_decomposition` (JSON schema + strict top-level
  allowlist + `RunRequestV3`).
- Forwarded to ISL ONLY on explicit `true` — the key is OMITTED otherwise (asserted:
  `'include_path_decomposition' in payload === false`), so no default payload growth on
  either boundary; unlike `include_e_values`/`include_voi` it is NOT defaulted on.
- Response section passes through verbatim (typed `ISLPathDecompositionV2`); presence is
  inherently request-gated (ISL emits it only when requested — confirmed live on both
  captures). No outcome-space denormalisation applies: path effects are dimensionless
  edge-coefficient products (structural decomposition, not a causal claim).

## Contract/spec surfaces updated

- `contracts/openapi.yaml` (hand-authored): request `include_path_decomposition`;
  response `sensitivity_reference_option_id` + full `path_decomposition` schema;
  `edge_sensitivity` description now states the populated-or-marked invariant.
- `src/contracts/isl-to-ui.contract.ts`: nested rename
  `robustness.edge_sensitivity → edge_sensitivity` (legacy top-level rename kept,
  marked fixtures-only); edge_id derive updated to `from_id`/`to_id`; two new
  passthroughs declared.
- `src/contracts/plot-to-isl.contract.ts`: conditional
  `include_path_decomposition` forward declared.

## Tests — RED→GREEN evidence

| Check | Result |
|---|---|
| RED proof: consumption read temporarily reverted (`transformEdgeSensitivity(undefined, …)`) | **4 tests fail** in the new liveness suite (edge_sensitivity `[]` + marker present + reference id checks) — the pre-fix behaviour is machine-detected |
| GREEN: fix restored, both liveness suites (20260706 warning path + 20260707 populated path) | **29/29 passed** |
| New envelope wire-truth unit tests + existing 20260706 envelope suite | **35/35 passed** |
| Boundary contracts (isl-to-ui, plot-to-isl) + passthrough + stability-thresholds suites | **72/72 passed** |
| `npx vitest run --changed` (176 files) | all passed after `npm run build` (two suites spawn `dist/main.js`; initial failures were missing-build environmental, not regressions) |
| `npx tsc --noEmit` | clean |
| Goldens | no golden fixture regenerated; goldens run inside the full pre-push suite (see PR for the gate result). The golden pricing-canary and 20260706 fixtures carry no `edge_sensitivity`/`factor_evpi` → their outputs are structurally unchanged by this lane |
| Full repo gate `scripts/pre-push-validate.sh` (typecheck + full `npm test` + stale-.js + dep audit) | run at push time via the Husky pre-push hook — result recorded in the PR |

Known pre-existing CI reds (not this lane): `audit` (fast-uri/fastify advisories) and
`gates (windows-latest)` (invalid path `tools/sdk-smoke:python.mjs`).

## Follow-ups (not this lane)

- UI consumption of `sensitivity_reference_option_id` (surface the baseline next to
  sensitivity displays) and of `path_decomposition` (opt-in wiring end-to-end).
- Consider emitting `sensitivity_score`/`direction` on public edge_sensitivity entries
  once the outward contract is opened for it (needs UI/CEE coordination).
- Retire the EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE warning entirely once no older-than-
  9a22a1a ISL deployment can serve PLoT (staging+prod both upgraded and pinned).
