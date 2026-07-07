# Lane PLoT-R3 — decision brief emission (2.7) + diligence evidence capture (2.13)

- **Branch:** `claude-lane10/brief-and-evidence` (fresh worktree from `origin/staging` @ `1823e07`)
- **Date:** 2026-07-07
- **Scope discipline:** ONE repo (plot-lite-service); cross-repo reads only
  (DecisionGuideAI UI-SEM inventory, read-only, to pin UI-SEM-060 semantics).
  All wire changes ADDITIVE (new optional fields only). No goldens modified.
  All new wording surfaces tagged `provisional_doctrine_v0`.

---

## Chronicle correction (trace of current state)

The lane brief said "assembleBrief() exists — chronicle says stubbed near
run.ts:1364 era; trace current state". Traced state on `origin/staging`
(1823e07): **not stubbed** —

- `src/assembly/decision-brief.ts:162` — full deterministic assembly
  (headline via M2→M1→fallback chain, ranked options, A1b-filtered
  top_drivers, evidence-gap key_assumptions, A1c-filtered
  what_would_change, level-mapped robustness, deduped warnings, lineage);
- `src/routes/v2/run.ts` — `decision_brief` ALREADY emitted on every
  /v2/run response (null when analysis failed or option_comparison /
  robustness absent), plus `_meta.decision_brief_assembled` diagnostic.

So Feature A landed as the **claim-safe surface extension** of the live
brief, not a from-scratch emission. What was missing vs the 2.7 spec:
banded leader wording (UI-SEM-060 producer leg), value_defaulted
assumption disclosures, an honest robustness caveat, and the
warning-code echo. All added additively.

---

## Feature A — decision_brief claim-safe surfaces (roadmap 2.7, G.2)

New optional fields on `DecisionBriefV1` (`src/types/decision-brief.ts`),
built in `src/assembly/decision-brief.ts`, all `provisional_doctrine_v0`:

| Field | Semantics | Claim-safety rule enforced |
|---|---|---|
| `headline_banded` | Leader claim banded by win-probability gap: `text`, `band`, leader/runner ids+labels, `win_probability_gap`, `robustness_gated`, `doctrine` | Bands EXACTLY 'very close' / 'slightly ahead' / 'clearly ahead'. gap < 0.10 (shared `NEAR_TIE_THRESHOLD` from `src/trust/result-coherence.ts`, so brief and `robustness.near_tie` can never disagree) → very_close; gap ≥ 0.25 (`CLEARLY_AHEAD_GAP_THRESHOLD`, provisional_doctrine_v0) AND robustness established → clearly_ahead; else slightly_ahead. **'clearly ahead' never emitted without established robustness** (`is_robust === true`, or `level === 'high'` with no explicit `is_robust === false`); downgrades carry `robustness_gated: true`. Absent when < 2 ranked options — no comparative claim without a comparison. |
| `defaulted_assumptions` | value_defaulted factors + DEFAULT-coded inference-warning echoes | Intervention-pinned levers EXCLUDED via the shared A1b predicate (`filterInterventionOverrides`) — a pinned lever never appears in "check this input" framing. Run-level disclosures echo the producer-owned warning message verbatim, deduped by code. Max 10, deterministic order. |
| `robustness_caveat` | `{ text, basis, doctrine }` | Wording derived STRICTLY from `is_robust` / `level`; when neither present, `basis: 'absent'` and the text says robustness was **not assessed** — absence stated, never implied stability. Explicit `is_robust: false` is never softened. |
| `warning_codes` | Warning-severity inference-warning codes | Codes only (no numbers, no prose), deduped, bytewise-sorted, capped 20. Info-severity NOT echoed. |

Forbidden-wording tripwire test: serialised brief contains no `EVPI`,
no `expected value`, no `sensitive to` (case-insensitive) —
`tests/decision-brief.claim-safety.test.ts`.

UI-SEM-060 alignment (read-only trace of
`DecisionGuideAI .claude/worktrees/*/CLAUDE.md` UI-SEM inventory row 060):
the UI's debt note is "Remove when PLoT provides a leader-confidence
band / close-call signal" — `headline_banded` is exactly that signal.
The UI retirement is **next-round wiring** (cross-lane sequencing rule:
consumption is not wired this round).

### Golden byte-identity

- Wire-capture goldens (`tests/golden/pricing-canary/*`): untouched;
  those tests assert field-level passthrough/semantics, not full-shape
  byte equality — unaffected by additive fields.
- Brief unit goldens (`src/fixtures/decision-brief/*.json`, compared via
  deep-equal in `tests/decision-brief.test.ts`): WOULD have broken.
  Per the lane rules, emission is gated behind **default-ON**
  `BRIEF_CLAIM_SAFE_SURFACES_ENABLE` (`src/config/flags.ts`; only
  explicit '0'/'false' disables), and the golden-fixtures describe block
  pins it '0'. **Fixture JSONs are byte-identical to staging.** The flag
  exists for no other reason and is ON in every deployed environment.
- Determinism replay (run-vs-run): new brief fields are pure functions
  of response data → identical across same-seed runs; suite passes
  unchanged (no new brief ignore entries).

---

## Feature B — diligence-grade evidence capture (roadmap 2.13)

Gap traced: the UI debug bundle reported `plot: null / isl: null`
because the full ISL payload mirror (`_meta.payloads`/`_meta.builds`)
is gated behind `UI_CANONICAL_META` (`src/routes/v2/run.ts:170`,
env-off in staging). Nothing on the default wire evidenced the ISL
exchange.

Added — ALWAYS present, additive `_meta.evidence`
(`EvidenceCaptureV1` in `src/types/engine-v3.ts`):

- `isl_request_digest` / `isl_response_digest` (`PayloadDigestV3`):
  sha256 over the **exact wire bytes**, UTF-8 byte length, sorted
  top-level key manifest. NOT full bodies. `src/integrations/isl/client.ts`
  now sends the pre-serialised request text and reads `response.text()`
  before parsing, so digests cover the true bytes, not a
  re-serialisation. Recorded on success, HTTP-error and network-failure
  paths (additive `DownstreamCall.requestDigest/responseDigest`,
  `src/util/downstream-tracker.ts`). Primary exchange = first
  `/robustness/analyze` call; flip probes remain in `downstream_calls`.
- `plot_build`: deployed SHA from the existing `BUILD_ID`/`GITHUB_SHA`
  build constant (same source as `_meta.plot_build`).
- `isl_build`: passthrough of the ISL response `build` field
  (string-typed check); `null` when ISL didn't run or didn't report —
  never invented.

Honest-null contract: all four keys always present; digests are `null`
(not absent) when the ISL HTTP client was not exercised
(route-level test proves this with the module-mocked ISL service).

Determinism note (recorded in-code and in
`tests/determinism-replay.test.ts`): the ISL request body carries
`request_id`, so the two digest fields are per-request volatile — they
are ignore-listed there with rationale (same class as the already
ignored `downstream_calls`); `evidence.plot_build` / `evidence.isl_build`
remain compared.

---

## Boundary audit (ADDITIVE-only check)

- `decision_brief` existing fields: unchanged semantics, unchanged
  emission condition. New fields optional.
- `_meta`: new optional `evidence` key; existing keys unchanged.
- `downstream_calls[*]`: new optional `request_digest`/`response_digest`.
- Request schema: untouched. `response_hash`: computed from request
  inputs only (`hashRequest`) — unaffected by all of the above.
- No non-additive change was needed; nothing was stopped/blocked.
- OpenAPI (hand-authored) updated additively:
  `DecisionBriefV1`, `PayloadDigestV1`, `EvidenceCaptureV1`,
  `decision_brief` + `_meta` on `V2RunResponse`. YAML parse verified.

## Consumer-skew note (system map hazard 1)

New fields are additive JSON on the wire. UI pins an older
`@talchain/schemas` and its Zod parsing may strip unknown keys — the
UI debug bundle reads the raw response, and consumption of
`headline_banded` / `evidence` is next-round work per the cross-lane
sequencing rule. No consumer is broken by absence or presence.

## Tests

- `tests/decision-brief.claim-safety.test.ts` (22): band wording matrix
  incl. exact 0.10/0.25 boundaries (float-exact values), robustness
  downgrade cases, pinned-lever exclusion from defaulted_assumptions /
  top_drivers / what_would_change, DEFAULT-code disclosure echo + dedup,
  honest robustness-caveat matrix incl. 'absent', warning-severity-only
  echo, EVPI/expected-value/sensitive-to tripwire, flag-gate both ways.
- `tests/evidence-capture.test.ts` (9): digest unit tests (exact bytes,
  multibyte length, sorted manifest, non-object payloads), ISLClient
  digest recording on success (whitespace-preserving exact-byte proof) /
  HTTP-error / network paths, route-level always-present + honest-null
  contract, end-to-end brief surfaces on /v2/run.
- Updated: `tests/decision-brief.test.ts` (flag pin for golden fixtures),
  `tests/request-id-chain.test.ts` (fetch stubs gained `text()` for the
  new exact-byte read), `tests/determinism-replay.test.ts` (digest
  ignore entries with rationale).

## Gates

- `npx tsc --noEmit`: clean.
- Targeted suites (brief, evidence, request-id-chain, determinism,
  golden/, report contract, meta/tier2/internal-field): all pass.
- Full `npm test` (build + vitest + fixture replay + OpenAPI + loadcheck):
  see PR checks / pre-push output. Known pre-existing CI reds unrelated
  to this lane: `audit` (fast-uri/fastify advisories) and
  `gates (windows-latest)` (invalid path `tools/sdk-smoke:python.mjs`).

## Follow-ups (not this round)

1. UI: consume `headline_banded` and retire UI-SEM-060 (+ 006/070
   closeness debt where applicable) — next-round wiring.
2. UI debug bundle: read `_meta.evidence` to close the "plot/isl
   unavailable" panel gap — next-round wiring.
3. Consider echoing digests for flip-probe ISL calls (currently primary
   call only; probes visible in `downstream_calls` when captured).
4. `CLEARLY_AHEAD_GAP_THRESHOLD` (0.25) is provisional_doctrine_v0 —
   ratify or adjust when doctrine v1 lands.
