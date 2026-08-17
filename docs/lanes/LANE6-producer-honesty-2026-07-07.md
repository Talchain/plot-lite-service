# Lane PLoT-H — producer honesty (items A / B / C)

- **Branch:** `claude-lane6/producer-honesty` (fresh worktree from `origin/staging` @ `04434eb`)
- **Date:** 2026-07-07
- **Live evidence source:** this morning's manual test, scenario `327bc417`
- **Scope discipline:** no ISL request change, no ISL change, no goldens modified.
  All wire changes are value-level (omission of optional fields) or additive
  (new optional fields / new open-vocabulary warning code).

---

## Item A — out-of-domain constraint chain (P1)

### Defect (live)

User set success target `20` unit `%` on `out_campaign_effectiveness` (a node
with no observed value). Chain observed live:

1. PLoT `plot.constraint_out_of_domain` (warn);
2. PLoT `constraint_normalisation original:20 → normalised:1, range_source:"default"`
   (threshold becomes "≥ domain max" against a made-up [0,1] range —
   `deriveRange()` bottoms out at the default tier for a node with no cap /
   range / hints / baseline / value: `src/lib/intervention-normaliser.ts:232`);
3. ISL `isl.constraint.default_base defaulted_to 0.0 reason no_parameter_uncertainty`,
   surfaced only as the info-level `CONSTRAINT_NODE_DEFAULT_BASE` inference
   warning (ISL emits no `severity` on the wire shape → PLoT's merge demotes to
   `info`: `src/routes/v2/run.ts` warning merge);
4. `probability_of_joint_goal: 0` for ALL options — meaningless "0% goal fit
   everywhere", the mirror image of the old 98% fabrication.

### Fix

- **New module `src/lib/constraint-reliability.ts`** —
  `detectUnreliableConstraintTargets(goalConstraints, constraintNormRanges, islResult)`.
  A constraint target is unreliable when **either** (i) its threshold
  normalisation used `range_source: 'default'`, **or** (ii) ISL named its node
  in a `CONSTRAINT_NODE_DEFAULT_BASE` inference warning (nested
  `detail.node_id` shape, exactly as ISL emits it —
  `Inference-Service-Layer/src/services/robustness_analyzer_v2.py:729-772`,
  read-only) or critique (`affected_node_ids`).
- **Suppression (`src/routes/v2/run.ts`, buildResponse):** when any target is
  unreliable, `probability_of_joint_goal` and `constraint_probabilities` are
  **omitted for the whole run** (absence is honest; the UI already gates
  goal-fit on absence). Raw computed values are logged in the
  `constraint_probability_suppressed` diagnostics event only — never emitted.
- **Warning:** one WARNING-severity `CONSTRAINT_TARGET_UNRELIABLE` inference
  warning per affected node (new open-vocabulary code added to
  `INFERENCE_WARNING_CODES`), naming the node label and the user action:
  *"Set a value or range for "<node>" to make this target computable."*
  Wording tagged `provisional_doctrine_v0` (see register below).
- **Coaching coherence (`src/coaching/m1-coaching.ts`):** the joint-probability
  readiness gate is skipped when targets are unreliable — otherwise coaching
  would fabricate `GOAL_FEASIBILITY_LOW` ("the best option may not achieve the
  target") from the placeholder 0. Additive optional parameter; existing
  callers unaffected.

### Evidence (RED→GREEN)

`tests/constraint-target-unreliable.fixture.test.ts` reproduces Paul's exact
chain (20/`%` on a valueless outcome node; ISL mock returns the live
`CONSTRAINT_NODE_DEFAULT_BASE` wire shape + joint 0):

- **RED on origin/staging @ 04434eb** (test copied into a pristine detached
  worktree): 4 failed / 2 passed —
  `probability_of_joint_goal` present (`opt_a … to not have property`),
  no `CONSTRAINT_TARGET_UNRELIABLE` (`expected [] to have a length of 1`),
  coaching contained `GOAL_FEASIBILITY_LOW`.
- **GREEN on this branch:** 6/6, including the CONTROL (target node with a
  derivable range + no default base → both fields still emitted, no warning —
  suppression is conditional, not blanket).

### Deliberately NOT changed (recorded)

- `constraint_results[].probability` / `constraints_status` still emit (the
  brief names exactly the two suppressed fields; the warning covers
  interpretation). Follow-up candidate if the UI renders constraint chips from
  `constraint_results` on unreliable targets.
- The ISL request is unchanged (per brief).

---

## Item B — recommendation_stability relabel

### Defect (live)

`enrichment.robustness.recommendation_stability` was **byte-identical** to the
leader's `win_probability` in BOTH manual tests (`0.59025` and `0.8541875`).
UI printed it as "N% stability" — a fabricated second statistic.

### Trace (producer → validator → consumer)

- **Producer (ISL, read-only):** `robustness_analyzer_v2.py:_compute_robustness`
  — `recommendation_stability = option_wins[most_frequent_winner] / n_samples`,
  i.e. the leader's win share **by construction** (only divergence: a
  multiplicative penalty when root nodes defaulted — a degradation of the same
  quantity, not an independent signal). The wire's `robustness.confidence` is
  itself derived from it (`min(0.99, stability × (1 − 1/√n))`), so **no
  genuinely distinct recommendation-level stability signal exists on the V2
  wire** — confirmed against the live capture
  `tests/fixtures/isl-v2-live-20260706/` (`recommendation_stability 0.59025`
  === max `win_probability 0.59025`, both captures).
- **PLoT emission sites (all removed):**
  1. `/v2/run` response `robustness.recommendation_stability`
     (`src/routes/v2/run.ts` buildResponse) — **stopped emitting** (key omitted);
  2. `buildRobustnessDataForCee`
     (`src/integrations/isl/adapters/robustness-enrichment.ts`) — **stopped
     forwarding**, and stability alone no longer counts as "meaningful
     robustness data" (returns null).
- **Contract docs updated:** `contracts/schemas/plot-response.schema.json`
  (`robustness.required` no longer lists it; property marked DEPRECATED),
  `src/contracts/isl-to-ui.contract.ts` (declared drop). Type fields kept
  optional for inbound tolerance, marked `@deprecated`.

### Evidence

- Liveness pin (GREEN here, **RED on staging**: `expected … not to have
  property "recommendation_stability"`):
  `tests/isl-v2-liveness.fixture.test.ts` — asserts the wire byte-identity
  (`captureA.robustness.recommendation_stability === max win_probability`) AND
  the response omission.
- `tests/robustness-enrichment.test.ts` updated: builder omits the field;
  stability-only payload → null.

### Residual (recorded, NOT changed — out of scope / higher-risk boundary)

- **M2 decision-review request** (`src/cee/decision-review-request.ts:294`,
  `decision-review-orchestrator.ts:386`) still sends
  `recommendation_stability ?? 0` to CEE as numeric grounding for the m1
  review validator (`m1-review-types.ts` marks it REQUIRED). Removing it is a
  non-additive change to the PLoT→CEE request shape → left intact per rule 6;
  the review LLM could still quote "59% stability" in prose. **Follow-up.**
- Internal verdict derivations (`src/coaching/normalise-inputs.ts`,
  `src/assembly/decision-brief.ts`) still read ISL's value to derive
  robust/fragile verdict classes — they do not emit the number; unchanged.
- Golden fixture-identity tests (`tests/golden/golden.test.ts:103`,
  `tests/golden/integration.test.ts:210`, `near-tie.golden.test.ts`) compare
  static capture files to each other (they do not run the route) and pin the
  CAPTURE's passthrough era; goldens untouched per brief. The live-surface
  non-emission is pinned by the liveness test instead.

---

## Item C — VOI over-zeroing + real EVPI (P-5, provisional-doctrine authorized)

### Defect (live)

All 5 factors had `value_of_information: 0` including unpinned ones. Root
cause: the heuristic `|sens| × (1 − conf) × max(marginal_switch_probability)`
(`src/lib/factor-influence.ts:computeValueOfInformation`) flattens to 0 for the
whole surface when `marginal_switch_probability` is uniformly 0 (known
failure mode) — so `evpi_percentage_points` (heuristic = VOI × spread × 100)
carried no ranking information for "worth checking next".

### Fix

- **Flag flip (`src/config/flags.ts`):** `ISL_FACTOR_EVPI_INTERNAL` default now
  **ON for `NODE_ENV=test` and staging (`RENDER_SERVICE_NAME` contains
  "staging")**, **OFF for prod**; explicit env overrides both ways
  (`'0'/'false'`, `'1'/'true'`).
- **Promotion (`src/routes/v2/run.ts` EVPI enrichment):** when the flag is on
  AND the ISL V2 wire carries `factor_evpi[]`, the Lane-2 guarded mapping
  (`mapIslFactorEvpi`, `src/integrations/isl/v2-envelope.ts`) feeds
  `factor_sensitivity[].evpi_percentage_points` with
  `evpi_method: 'counterfactual'` **in place of** the heuristic for the run
  (no mixed-scale ranking). Heuristic remains the fallback when `factor_evpi`
  is absent or the flag is off — that path is byte-identical to before.
- **Sanitisation (unchanged core + extended):** negatives are NEVER emitted;
  below-resolution estimates (< 0.05pp, includes all MC-noise negatives) are
  labelled with the new additive optional field
  `factor_sensitivity[].evpi_status: 'below_resolution'` and
  `evpi_percentage_points` stays ABSENT (never a clamped 0). ISL's **new
  `evpi_status` wire field is honoured where present** (an explicit
  `'below_resolution'` from the producer overrides PLoT's local threshold;
  `'ok'` does not un-label sub-resolution raws). The field is typed optional
  (`isl-types.ts`) — the 2026-07-06 capture predates it; ISL src has no
  emitter yet (verified read-only grep), so this is forward tolerance.
- **P0a preserved:** option-pinned levers (`zero_reason:
  'intervention_override'`) never carry EVPI in any form, even when ISL
  supplies an estimate for them (the live capture does: `fac_dev_headcount`
  1.85pp is a lever — verified skipped).
- **Specs updated (hand-authored):** `contracts/openapi.yaml`
  (`evpi_percentage_points` source disclosure + new `evpi_status`),
  `openapi/openapi-plot-lite-v1.yaml` (`FactorSensitivityV3` additions),
  `contracts/schemas/plot-response.schema.json`, `isl-to-ui.contract.ts`
  enriched list, `cee-no-voi.type-pin.ts` (added `evpi_status` to the
  forbidden-on-CEE-request union).

### Copy check ("EVPI" / "expected value" never user-facing)

- Grep of `src/` message/label surfaces: **no PLoT-emitted user-facing string
  contains "EVPI" or "expected value" on the VOI surface.** The strings exist
  only in field names (`evpi_percentage_points` — pre-existing wire vocabulary),
  code comments, and log events. The UI renders the "worth checking next" /
  "Investigate" label class from these fields (verified read-only:
  `DecisionGuideAI/src/components/results/utils/groupActionItems.ts` ranks by
  `evpiPp → evpi → voi`; `analysisSnapshotFactory.ts:67` maps
  `f.evpi_percentage_points`).
- Pre-existing unrelated copy: `src/routes/v1/analysis-pareto.ts:76-80` says
  "higher expected value" about **outcome expected value** on a v1 Pareto
  surface — not the VOI/EVPI surface; left unchanged (recorded).

### Evidence

- **Golden pricing-canary byte-identical:** its ISL fixture has NO
  `factor_evpi` → `mapIslFactorEvpi` returns 0 entries → fallback heuristic
  path executes exactly the pre-change loop. `tests/golden/` all green
  (fixtures untouched); `canonical-route-integration` (canonicalCompare
  idempotency) green.
- Liveness (GREEN here, **RED on staging**: 2 of the 3 new C assertions fail
  pre-fix): counterfactual mapping (1.45pp → 1.5pp rounded, method
  disclosed), lever exclusion, below-resolution labelling
  (`fac_hiring_cost` −0.15pp → `evpi_status`, no pp, no 0, no negative), and
  a flag-OFF (prod posture) block proving no counterfactual output when off.
- Unit: `tests/isl-v2-envelope.unit.test.ts` — `evpi_status` honour/override
  semantics.

### Claim register (provisional_doctrine_v0)

| # | Surface | Claim now made | Basis | Guard |
|---|---------|----------------|-------|-------|
| C-1 | `factor_sensitivity[].evpi_percentage_points` (+`evpi_method: 'counterfactual'`) | "checking this factor could shift the win probability by ~Npp" | ISL per-factor counterfactual EVPI (Monte Carlo, `n_evpi_samples`) | ≥0 always; rounded 0.1pp; staging/test only (prod flag OFF); method disclosed |
| C-2 | `factor_sensitivity[].evpi_status: 'below_resolution'` | "too small to measure at this sampling depth" (NOT "measured zero") | Emission resolution 0.05pp (`evpi-emission.ts`), incl. all MC-noise negatives; ISL `evpi_status` honoured | value field absent; raw stays in diagnostics |
| C-3 | Heuristic fallback unchanged (`evpi_method: 'heuristic'`) | unchanged pre-existing claim | VOI × spread × 100 | unchanged; canary byte-identical |
| A-1 | `CONSTRAINT_TARGET_UNRELIABLE` warning message | "this target can't be evaluated reliably; numbers withheld; set a value/range" | detection per `constraint-reliability.ts` | wording tagged `provisional_doctrine_v0` in source |

### provisional_doctrine_v0 wording surfaces (rule 9 list)

1. `src/lib/constraint-reliability.ts` — `buildConstraintTargetUnreliableMessage` (tagged in source comment).
2. `src/routes/v2/run.ts` — CONSTRAINT_TARGET_UNRELIABLE emission site (tagged in source comment).
3. Item C carries no new user-facing prose (fields only); the doctrine tag applies to the promotion decision itself (flag docs + this report).

---

## Test summary

| Suite | Result |
|-------|--------|
| `tests/constraint-target-unreliable.fixture.test.ts` (NEW) | 6/6 GREEN (4 RED on staging) |
| `tests/constraint-reliability.unit.test.ts` (NEW) | 11/11 GREEN |
| `tests/isl-v2-liveness.fixture.test.ts` (extended) | 16/16 GREEN (3 RED on staging) |
| `tests/isl-v2-envelope.unit.test.ts` (extended) | 25/25 GREEN |
| `tests/robustness-enrichment.test.ts` (updated) | 33/33 GREEN |
| Golden batch (`tests/golden/**`, goldens untouched) | 25 files / 451 tests GREEN |
| Boundary/gates (`boundary-isl-to-ui`, `voi-enrichment-pin`, `lane-p0a-lever-evpi-egress`, `enrichment-emission-contract`, `canonical-route-integration`) | GREEN |
| `npx tsc --noEmit` | clean |
| Full `npm test` | see PR body / final report |

Known pre-existing CI reds (unrelated, per repo CLAUDE.md): `audit`
(fast-uri/fastify advisories) and `gates (windows-latest)` (invalid path
`tools/sdk-smoke:python.mjs`).

## Follow-ups (recorded, not done)

1. M2 decision-review request still carries `recommendation_stability ?? 0`
   (required by the CEE-side m1 validator contract) — retiring it needs a
   coordinated CEE change (non-additive boundary change, rule 6).
2. `constraint_results[].probability` still emits on unreliable-target runs
   (scope: brief named the two suppressed fields); revisit if the UI renders
   constraint chips from it.
3. ISL `factor_evpi[].evpi_status` has no producer yet (typed as forward
   tolerance here); when ISL ships it, the honour-path is already tested.
4. Prod flip of `ISL_FACTOR_EVPI_INTERNAL` is a Paul-gated decision (P-5 full
   ratification) — staging/test ON only in this change.

---

## ⚠ CORRECTION APPENDED 2026-08-17 — one claim in this document was FALSE

**This document is a dated record and its original text above is left exactly as
written.** One sentence in it was wrong when written, and it went unchallenged for
six weeks because the repo's own record asserted the thing nobody then re-measured.

### The false claim

Under *"Residual (recorded, NOT changed)"*, this document states:

> Internal verdict derivations (`src/coaching/normalise-inputs.ts`,
> `src/assembly/decision-brief.ts`) still read ISL's value to derive
> robust/fragile verdict classes — **they do not emit the number**; unchanged.

**The second half is false, and it named the right file.**
`normalise-inputs.ts:166` reads `islResult.robustness.recommendation_stability`
into the coaching layer as `recommendationStability` — and three coaching builders
downstream of it interpolated that value into user-facing prose as
`"N% recommendation stability"`:

- `src/coaching/executive-summary.ts:122, 133`
- `src/coaching/next-actions.ts:117, 137, 148-149`
- `src/coaching/readiness-signals.ts:177, 184`

All three are on the live `POST /v2/run` path (`run.ts:152` import →
`run.ts:8260` `generateM1Coaching(processedIslResult)` → `m1-coaching.ts:159/196/203`
→ published at `run.ts:3799` / `run.ts:4062` as `m1_coaching`), and the leak was
wire-witnessed in this repo's own checked-in golden for the 2026-07-07 capture:

> `"key_qualifier": "However, the 59% recommendation stability indicates the
> decision could shift with new information."`

`0.59025` is the exact value item B's own rationale certifies as byte-identical to
the leader's `win_probability`. So the withhold removed the FIELD while the prose
kept publishing the QUANTITY — and, being prose, it published it with no field a
user or the UI could check it against. Item B's stated goal ("omission is honest
absence") was therefore not met on the surface a user actually reads.

### What the distinction should have been

The correct split is not *"verdict derivations vs emitters"* but **"thresholding
the value vs printing it"**. Two consumers genuinely only threshold it and were
correctly characterised — `readiness-tone.ts:63-65` (emits the reason code
`LOW_STABILITY`) and `headlines.ts:198, 203` (classifies headline type). The three
above printed it. A sweep that had asked *"does this value reach a template
string?"* rather than *"is this module a verdict deriver?"* would have separated
them.

### Fixed

Fixed 2026-08-17 (branch `fix/withheld-number-prose-leak-2026-08-17`) by removing
the figure and keeping the qualitative claim, on the reading that item B's
rationale is about the QUANTITY ("zero independent information", "a fabricated
second statistic") and not about contract shape. Pinned by
`tests/coaching/withheld-stability-prose-egress.test.ts`, which sweeps EVERY string
in the built `m1_coaching` payload rather than checking a list of known sites — so
the next emission site fails a test instead of needing someone to remember this
document. Follow-up 1 below (the M2 decision-review request, which still sends
`recommendation_stability ?? 0` to CEE and whose review LLM this document already
warned "could still quote '59% stability' in prose") remains OPEN and is unchanged
by that fix.
