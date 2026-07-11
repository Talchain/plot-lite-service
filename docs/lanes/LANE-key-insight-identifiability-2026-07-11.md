# LANE — key-insight identifiability thread-through (CEE #427 follow-up)

Date: 2026-07-11
Branch: `claude-plot/key-insight-identifiability` (base `origin/staging` cd369634d)
Motivation: CEE's key-insight handler (post-#427) gates confident causal
language on an `identifiability` block in the request. PLoT computes
identifiability live on both run paths (v1 `run.ts` `checkIdentifiability`;
v2 `run.ts` `assessGraphIdentifiability`, always present in the V2 response)
but the key-insight proxy (`src/routes/v1/key-insight.ts` → `ceeRequestBody`)
sent none — so CEE hedged on every request, including cleanly identifiable
graphs. This lane threads the already-available computation into the proxy
request so confident language is EARNED, and hedging is honest.

## 1. What landed (commit by commit)

| Commit | Change |
|---|---|
| d571c12 | RED: `tests/key-insight-identifiability.test.ts` + pre-thread baselines. `npx vitest run tests/key-insight-identifiability.test.ts` at this commit: **3 failed (thread-through assertions) / 2 passed (byte-identity pins)**. Fixtures under `tests/fixtures/key-insight-identifiability/` were captured FROM staging cd369634d via the committed `capture-baselines.ts` (run twice; both outputs byte-identical — determinism verified). `baseline-cee-request.json` is the fixture proof that today's outbound CEE request carries **no** `identifiability` field. |
| 0ce652a | GREEN: thread-through. `src/routes/v1/key-insight.ts` computes `checkIdentifiability` (the same helper `/v1/run` uses, same treatment default = first node; outcome = the route's resolved outcome node), maps it via new exported `toCeeIdentifiability()`, and appends it to `ceeRequestBody`. `src/routes/v1/types/key-insight.types.ts` adds `CeeIdentifiability` + optional `identifiability` on `CeeKeyInsightRequestBody`. |
| (this commit) | Lane doc. |

## 2. Shape contract (verified against CEE source, not assumed)

Read directly from `olumi-assistants-service`:

- `src/schemas/cee.ts` `IdentifiabilitySchema`:
  `identifiable: boolean` (required); `method`, `adjustment_set`,
  `explanation` all `.nullable().optional()`. `CEEKeyInsightInput` declares
  `identifiability: IdentifiabilitySchema.optional()` and is `.strict()` at
  the top level — `identifiability` is an accepted key.
- `src/routes/assist.v1.key-insight.ts` (~lines 206–213): guarded ternary maps
  `input.identifiability` through only when present.
- `src/cee/key-insight/index.ts`: `identifiability?.identifiable ?? true`
  drives confident vs exploratory language; when identifiable and `method`
  is set, CEE emits "Causal effects confirmed via {method} criterion."

Mapping decisions in `toCeeIdentifiability()` (all fail-honest):

| CEE field | Source | Rule |
|---|---|---|
| `identifiable` | `IdentifiabilityResult.identifiable` | verbatim — **never defaulted to true** anywhere on the path |
| `method` | `adjustment_metadata.criterion` | named only when a criterion was actually applied; `'none'` → `null` (otherwise CEE would say "confirmed via none criterion") |
| `adjustment_set` | `IdentifiabilityResult.adjustment_set` | verbatim (sorted, deterministic) |
| `explanation` | `summary` (+ `notes` joined when non-identifiable) | CEE surfaces `explanation` as the user-facing note in the non-identifiable case, so the detail ("No causal path from treatment to outcome") rides along |

## 3. Pins (byte-identity when the computation is absent)

- The `checkIdentifiability` call is wrapped in try/catch. On throw, the field
  is **omitted** (never a fabricated default) and the outbound CEE request is
  byte-identical to the pre-thread baseline — pinned by mocking the helper to
  throw and string-comparing the captured body (modulo `plot_request_id`,
  a per-request correlation id) against `baseline-cee-request.json`.
- The caller-facing `/v1/assist/key-insight` response is untouched by this
  lane — pinned by string-comparing `res.body` against
  `baseline-response.json` (CEE flag off, fixed seed 4242).

## 4. Gates (commands + counts, this worktree, base cd369634d)

| Gate | Command | Result |
|---|---|---|
| Targeted tests | `npx vitest run tests/key-insight-identifiability.test.ts tests/key-insight.test.ts` | 41/41 passed (5 new + 36 existing) |
| Typecheck | `npx tsc --noEmit` | clean |
| Full gate | `bash scripts/pre-push-validate.sh` | PASSED — full suite **5467 passed / 25 skipped**, stale-.js clean, dep policy OK, spectral OK |
| Standing CI reds | `audit`, `gates (windows-latest)` | pre-existing on every PR (memory-documented); unrelated to this change |

## 5. Honest limits / residuals

- **Treatment-node choice is the `/v1/run` default (first graph node), not a
  per-option assessment.** The proxy ranks multiple options but sends one
  graph-level identifiability block (that is all CEE's schema accepts). A
  per-(option, outcome) roll-up like v2's `assessGraphIdentifiability` would
  be more faithful for multi-option graphs; deferred — needs a CEE schema
  conversation first.
- **Pre-existing request/schema skew (NOT introduced here, observed while
  verifying):** CEE's `CEEKeyInsightInput` is `.strict()` and requires
  `graph` + `ranked_actions[{node_id, expected_utility, ...}]`, while the
  PLoT proxy sends `plot_request_id`/`graph_summary`/`ranking_confidence` and
  a different `ranked_actions` shape. If the flag were enabled against real
  CEE today, the request would 400 (`CEE_VALIDATION_FAILED`) and fall back —
  identifiability included. This lane matches the identifiability field shape
  exactly so it is correct whenever the wider skew is closed; closing the
  skew itself is a separate lane.
- Live wire not exercised: verification is unit/fixture-level (mocked fetch).
  No staging traffic was sent; reserved staging scenarios untouched.
