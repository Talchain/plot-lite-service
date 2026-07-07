# Lane PLoT-W5 (lane 18) evidence report — display-safe robustness verdict on /v2/run

- Date: 2026-07-07
- Branch: `claude-lane18/robustness-display-verdict` (fresh worktree; base `origin/staging` @ `14dd31a`)
- Roadmap: Tier 1.6, **producer side** — ends the "Robustness unknown" era. The UI
  hardcodes `robustnessVerdict = undefined` because no display-safe field exists on the
  /v2/run wire: it carries `robustness.is_robust` / `level` / `confidence`, but the UI is
  forbidden to re-derive meaning from raw producer facts (claim-safety doctrine: meaning
  is producer-owned). The UI consumer leg is a separate lane.
- Contract status: **ADDITIVE ONLY** — two new optional fields on the existing
  `robustness` object (`display_verdict`, `display_verdict_reason`). No boundary field
  renamed, retyped, removed, or made required. No request-shape change. Nothing
  non-additive was needed — no blocker raised.
- Doctrine: the verdict **mapping** and every **reason phrase** are tagged
  `provisional_doctrine_v0` (module doc, type JSDoc, both OpenAPI specs, contract file).

## RED inheritance

A previous session on this lane was killed by an account usage limit mid-implementation
after committing the RED route-level fixture test as a checkpoint
(`3a8ea15`, `tests/robustness-display-verdict.fixture.test.ts`). This session resumed
from that branch tip and **re-confirmed RED against the pristine baseline first**:
10/10 tests failing (every `display_verdict` expectation received `undefined`) before
any implementation code was written. After implementation: 10/10 GREEN, plus 13 new
unit mapping-table tests (`tests/robustness-display-verdict.unit.test.ts`).

## What is emitted (commit `0964db6`)

`robustness.display_verdict` — enum `'robust' | 'moderate' | 'fragile' | 'not_assessed'`
and `robustness.display_verdict_reason` — one short producer-owned phrase per verdict.

Derivation module: `src/routes/v2/robustness-display-verdict.ts` (pure function, single
source of truth). Mapping table (**provisional_doctrine_v0**, evaluated strictly in
order):

| # | Producer facts | Verdict |
|---|---|---|
| 1 | robustness not computed (absent / failed / blocked — `robustness_status !== 'computed'`) | `not_assessed` |
| 2 | `is_robust === false` (explicit negative always wins — never softened by level/confidence) | `fragile` |
| 3 | `level === 'low' \| 'very_low'` | `fragile` |
| 4 | `level === 'medium'` (ISL wire vocabulary) `\| 'moderate'` (UI-vocabulary tolerance) | `moderate` |
| 5 | `is_robust === true` **AND** `level === 'high'` (both facts required — level alone never upgrades) | `robust` |
| 6 | verdict-bearing facts missing or unrecognised | `not_assessed` |

Reason phrases (**provisional_doctrine_v0**, claim-safe, no numbers — the UI renders
them verbatim):

- `robust` → "this result held up under the changes we tested"
- `moderate` → "this result mostly held up, but could shift under some changes"
- `fragile` → "small changes could flip this result"
- `not_assessed` → "robustness was not assessed for this run"

### Honesty invariants (each pinned by a test)

- **Never a determinate-looking verdict when robustness wasn't computed** — rule 1 gates
  on `robustness_status === 'computed'`; blocked (422) and failed error shapes always
  carry `not_assessed`; a computed robustness whose verdict-bearing facts are missing is
  also `not_assessed` (rule 6).
- **Confidence can never upgrade a verdict** — it is not an input: the derivation
  function signature does not accept it (pinned live: `confidence: 0.99` on the fragile
  capture still yields `fragile`).
- Unrecognised external values (ISL is external input) degrade to `not_assessed` —
  never a crash, never a fabricated verdict.

### Emission sites (all /v2/run response shapes)

- `buildResponse` (`src/routes/v2/run.ts`) — success / partial / failed 200 shapes,
  derived from the **assembled** `robustness.is_robust`/`level` after the CIL Phase-0
  fallback, gated on `robustnessStatus === 'computed'`. Covers both call sites (main ISL
  path and the `graph_fallback` ISL-not-enabled path — the latter passes
  `robustnessStatus: 'unavailable'` → `not_assessed`).
- `buildV2RunError` — blocked (422) and failed error shapes: the CIL 0.2 empty
  robustness object now also carries `display_verdict: 'not_assessed'` + reason.

Not touched: the PLoT→CEE enrichment payload (`buildRobustnessDataForCee`),
`decision_brief.robustness_caveat` (lane PLoT-R3 surface), `fact_objects` lineage.

## Fixture derivation (live capture sets, as mandated)

Route-level tests mock only the ISL transport and replay the **committed live
captures**:

- `tests/fixtures/isl-v2-live-20260706` (ISL build `f3f5d92`): the live **fragile**
  case — `is_robust: false`, `level: 'low'` → `display_verdict: 'fragile'`, with
  producer facts asserted unchanged on the wire (additive proof).
- `tests/fixtures/isl-v2-live-20260707` (ISL build `9a22a1a`, see its `PROVENANCE.md`):
  same verdict facts on the newer deployed build → `'fragile'`.
- **Absent-robustness case**: the 20260706 capture with the `robustness` key deleted →
  `robustness_status !== 'computed'`, CIL fallback object carries `'not_assessed'`.
- Synthetic mapping-table edits clone a capture and edit **only** the verdict-bearing
  facts (`is_robust`/`level`): robust, moderate, is_robust-false-beats-level-high,
  confidence-cannot-upgrade, facts-missing.
- **Blocked path**: preflight-blocked request (missing goal node) → 422 with
  `'not_assessed'` on the CIL empty robustness object.
- Claim-safety: every emitted reason asserted digit-free (`not.toMatch(/\d/)`).

## Contract surfaces (commit `4bfc01d` — all additive)

- `src/types/engine-v3.ts` — `RobustnessAssessmentV3.display_verdict?` +
  `display_verdict_reason?` (optional on the type for inbound tolerance of old
  payloads; emitted on every /v2/run response by current builds).
- `openapi/openapi-plot-lite-v1.yaml` (hand-authored, updated manually per repo rule):
  `V2RunResponse.robustness` gains the two properties (enum documented);
  `V2RunError.robustness` documents the always-`not_assessed` verdict.
- `contracts/openapi.yaml` (the spectral-linted spec): same additions on
  `runResponseV3.robustness` + `v2RunError.robustness`. Spectral: 0 errors (the
  `MarginSensitivity` unused-component warning is pre-existing on `origin/staging`).
- `src/contracts/isl-to-ui.contract.ts` — `robustness.display_verdict` +
  `robustness.display_verdict_reason` declared in `enriched` (fields PLoT adds that ISL
  does not provide).

## Goldens: byte-identical, no flag needed

The lane-10 escape hatch (default-ON flag pinned `'0'` in the golden describe block) was
**not needed**: no golden/fixture test byte-compares a stored /v2/run response
containing the `robustness` object. Verified by (a) the full suite passing with the
fields emitted unconditionally — including `tests/golden/*` (engine + near-tie +
canonical-route), `tests/decision-brief.test.ts` golden fixtures (assembled from
analysis inputs, not the response robustness object — fixture JSONs untouched), and
`tests/v2-determinism.test.ts` (response_hash canonicalises the REQUEST, so an additive
response field cannot drift it); and (b) grep review of `toEqual`/`Object.keys` pins on
`robustness` — all are sub-array or field-level assertions, none pin the key set.
Because emission is unconditional, staging behaviour needs no env/flag coordination.

## Verification (fresh worktree, authoritative gates)

- Tier 1: `npx tsc --noEmit` — clean.
- Targeted suites (this change + nearest neighbours): fixture 10/10, unit 13/13,
  `boundary-isl-to-ui.contract` 24/24, `cil-phase02-blocked-robustness` 2/2,
  `v2-determinism` 27/27.
- Full authoritative gate `bash scripts/pre-push-validate.sh`, run 1 (honest
  attribution): **2 failures, both understood** —
  1. spectral `array-items` errors on the two array stubs I had added to
     `v2RunError.robustness` — **mine**, fixed by adding `items` (folded into
     `4bfc01d`);
  2. `tests/error.taxonomy.test.ts` "RATE_LIMIT → 429" — **unrelated flake**: the test
     spawns its own server on fixed port 4343 inside the fully parallel suite; passes
     12/12 in isolation; no robustness/verdict code is anywhere near it.
  Everything else: 5292 passed / 1 failed / 25 skipped across 493 files.
- Full gate, run 2 (after the spectral fix): spectral **PASS** (0 errors; the
  `MarginSensitivity` warning is pre-existing on staging). Test step: 5291 passed /
  **2 flaked** — `error.taxonomy` 429 again, plus `option-compare` include_debug
  (`503` from its spawned server under full parallel load). Both pass 17/17 when run
  in isolation immediately afterwards. The flake set DIFFERS between the two runs
  (run 1: error.taxonomy only; run 2: error.taxonomy + option-compare) — the
  signature of load-sensitive spawned-server tests, not of a deterministic
  regression; neither test touches any surface in this diff (draft-flows
  rate-limiting and /v1/run option-compare debug).
- **Pristine-baseline attribution**: full `npm test` on a fresh worktree at
  `origin/staging` @ `14dd31a` (identical environment, cloned node_modules):
  BASELINE_RESULT_PLACEHOLDER.
- Known pre-existing CI reds (per repo `CLAUDE.md`, not chased): `audit`
  (fast-uri/fastify advisories) and `gates (windows-latest)` (invalid path
  `tools/sdk-smoke:python.mjs`).
