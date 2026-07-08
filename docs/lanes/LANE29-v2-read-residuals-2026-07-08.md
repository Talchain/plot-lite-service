# LANE 29 — V2-read residuals: wire-generation assertion + dead-read cleanup (ROADMAP 1.24)

Date: 2026-07-08
Branch: `claude-lane29/v2-read-residuals` (base `origin/staging` 524c488 — includes LANE27/PR #205)
Spec of record: `PLOT-V2-READ-FIX-SPEC.md` (olumi-schemas, `docs/enrichment-v1/`) — Brief F's
residual list after its verdict flip.

## 0. Scope note — what this lane deliberately did NOT redo

Brief F originally flagged PLoT reads of V1-shaped ISL fields the V2 wire never
emits (`edge_e_values`, `sensitivity`, `computed_at`, `validation_status`,
`factor_sensitivity[].value_of_information`). **Those fixes had already landed
on staging** via `src/integrations/isl/v2-envelope.ts` (lanes PLoT-W4 / PLoT-H,
present in base 524c488). This lane VERIFIED them machine-checkably instead of
re-implementing (spec §1): every "already fixed" location claim is pinned by
`tests/contract/isl-to-plot.contract.test.ts` against real staging captures —
if any claim had been wrong, the pin would have failed on base. It didn't
(14/14 green on base at install time, commit 17e8984).

## 1. What landed (commit by commit)

| Commit | Spec item | Change |
|---|---|---|
| 17e8984 | §3.1 | Contract test installed (ISL→PLoT wire-shape manifest, 14 pins) + `/v2/run` golden byte-identity pin generated on PRE-LANE base 524c488 (volatile fields masked by key, key order preserved; the ONE spec-mandated additive field is stripped) |
| f5ced7c | §2.3 | `buildISLResponseSummary.sensitivity_count` counted top-level `islResult.sensitivity` — structurally 0 on every live V2 response. Now counts `getIslEdgeSensitivity(islResult)?.length ?? 0` (the same accessor the response readers use). RED first: 1 failed ("expected +0 to be 26") |
| 7b3cbd2 | §2.2 | Dead `validation_status` reads in `src/cee/orchestrator.ts` DELETED (mapping + `VALID_VALIDATION_STATUS`/`VALID_CONFIDENCE_VALUES` guards). The live V2 wire never emits the field (contract-pinned) and `/v2/run`'s `buildCeeReviewRequest` never set it — branches that could never fire. Deleted rather than remapped to `identifiability.status`: remapping would CHANGE the CEE-facing block on live runs — a product decision, recorded in §5. `/v1/run` validation reads are a legacy V1 surface, out of scope per spec |
| 553b9a9 | §2.1 | **Wire-generation assertion** (the brief's outstanding ask) — see §2 below |
| 10c452e | §3.2 | Fixture re-captured against the then-deployed ISL build `3773f76` (byte-identical request; wire shape UNCHANGED vs 9a22a1a); contract test parameterised over both captures (30 pins) |

## 2. §2.1 mechanism — `src/integrations/isl/wire-generation.ts`

Problem: PLoT pins the REQUEST side (`?response_version=2` +
`X-ISL-Response-Version: 2`, `client.ts`) but nothing asserted the RESPONSE
generation — nobody read the envelope's `build`/`engine_version`/`version`, so
a mis-deployed or rolled-back ISL silently reintroduces empty science.

- **Marker-based, not ordinal** (build SHAs have no order relation):
  after each successful `robustness/analyze` call the envelope must
  (a) DECLARE its version markers — `build`, `engine_version`, `version`
  matching major 2, `timestamp` (all present on every live capture), and
  (b) pass WIRE-LOCATION PROBES for the nested fields the `v2-envelope.ts`
  readers assume: `robustness.edge_e_values` (emitted since f3f5d92) and
  `robustness.edge_sensitivity` (emitted since 9a22a1a). A probe fails only
  when `robustness` is present but the LOCATION is absent — an EMPTY array at
  the location is computed-empty (honest), not a wire gap. When `robustness`
  is absent entirely the probes are skipped (computation outcome; the
  per-feature status machinery already degrades it).
- `ISL_MIN_WIRE_GENERATION = '9a22a1a'` documents the assumed generation and
  is carried in the warning for operator comparison against `/health`. It must
  be updated ALONGSIDE any reader change in `v2-envelope.ts` that assumes a
  newer wire location.
- On mismatch/absence: **ONE structured warning** per response
  (`event: 'isl_wire_generation_unverified'`, carrying declared markers,
  missing markers, min generation, request_id) — emitted at the ISL boundary
  in `/v2/run`'s success branch.
- **NEVER a hard fail** (spec): absence of enrichment is degraded-but-usable;
  `analysis_status` stays `'computed'` on a mismatched wire (test-pinned).
- Surfaced to consumers as **`_meta.evidence.isl_wire_generation_ok: boolean`**
  (engine-v3 `EvidenceCaptureV1` + OpenAPI `EvidenceCaptureV1`, additive;
  `false` also covers "no successful ISL exchange" — unverified is unverified).
- **Honest per-feature degradation** for the probe-failure case: new
  `EDGE_E_VALUES_UNAVAILABLE_V2_WIRE` inference warning (info severity,
  mirrors `EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE`) fires in `buildResponse`
  when robustness came back without the `edge_e_values` location — previously
  that shape emitted a SILENT `[]` indistinguishable from "computed and found
  nothing". Invariant: location present OR marker present, never a silent
  empty from a missing location on a computed analysis.
- Flip-probe / threshold ISL calls (`run.ts` ~5177/5279) are NOT asserted —
  the assertion covers the primary science exchange only (deliberate, §5).

## 3. Verification (exact commands + counts)

- **RED first** (§2.1, before implementation):
  `npx vitest run tests/isl-wire-generation.assertion.test.ts tests/isl-wire-generation.unit.test.ts`
  → **Test Files 2 failed (2); Tests 5 failed (5)** — "expected undefined to
  be true/false" on `isl_wire_generation_ok`; deleted
  `robustness.edge_e_values` produced a silent computed-empty; unit file:
  module not found. (Earlier RED evidence for §2.3 is in f5ced7c's message.)
- **GREEN after**: same command → 17 passed (5 integration + 12 unit; 13 unit
  after the 3773f76 case).
- **Byte-identity for well-formed V2 responses** (spec "byte-identical pin"):
  `npx vitest run tests/isl-v2-golden-response.pin.test.ts` → 4 passed. The
  golden was generated on pre-lane base 524c488; the normaliser strips ONLY
  `_meta.evidence.isl_wire_generation_ok` — everything else, including key
  order, is byte-compared. Passing = the lane changed nothing else on a
  well-formed envelope.
- Contract + liveness + summary suites:
  `npx vitest run tests/contract/isl-to-plot.contract.test.ts tests/isl-wire-generation.unit.test.ts tests/isl-wire-generation.assertion.test.ts tests/isl-v2-golden-response.pin.test.ts`
  → **52 passed** (contract 30 = 15 pins × 2 captures). Liveness fixture
  (20260706 wire): 16 passed. `tests/isl-response-summary.unit.test.ts`: 4
  passed. Evidence-shape neighbours (`evidence-capture`, `determinism-replay`,
  `meta-diagnostic-fields`): 22 passed.
- **Full authoritative gate**: `npm test` (build → shared test server → vitest
  → fixtures/OpenAPI/loadcheck) → **498 files passed | 4 skipped; 5379 tests
  passed | 25 skipped; exit 0** (run AFTER the §2.1 implementation; §3.2's
  fixture/contract changes were additionally covered by the suites above and
  by the pre-push hook on the final push). `npx tsc --noEmit` clean.
  (NOTE: a raw `npx vitest run` without `npm test`'s build + TEST_BASE_URL
  server orchestration shows ~115 spawn-timeout file failures — environment
  artifact, reproduced on base, not lane-related.)
- **Live re-verification** (§3.2): deployed isl-staging build had moved to
  `3773f76` (`/health`, 2026-07-08T01:06Z). Byte-identical request replayed
  (HTTP 200, 1.4s) → wire shape UNCHANGED (same key sets; nested
  edge_e_values 13 / edge_sensitivity 26; no V1-era fields). Fixture:
  `tests/fixtures/isl-v2-live-20260708/` (PROVENANCE.md has method + counts).
  No staging scenario rows touched (direct ISL compute call; reserved
  scenarios 1909b083*/def3cb31*/8e0bf73d* untouched).

## 4. §2.4 — P-5 evidence package (decision for Paul; flag NOT flipped)

`FLAGS.ISL_FACTOR_EVPI_INTERNAL` (src/config/flags.ts:142): default ON for
test/staging, OFF for prod; explicit env overrides both ways. The lane
packages the evidence and changes nothing:

1. **Heuristic fallback (prod today) can flatten to zero information**: the
   VOI × win-probability-spread heuristic multiplied by
   `marginal_switch_probability` collapsed to 0 for ALL factors on live
   scenario 327bc417 (2026-07-07) because marginal_switch_probability was
   uniformly 0 — the "worth checking next" ranking carried no information.
2. **NEW (found during §3.2 re-capture): the current ISL wire labels ALL
   factor_evpi entries below-resolution.** The f3f5d92 capture (20260706)
   carried NO `evpi_status` on any entry (raw pp: +1.85, +1.45, +0.85,
   −0.15 at n_evpi_samples=500). The 9a22a1a AND 3773f76 captures carry the
   IDENTICAL estimates but declare `evpi_status: 'below_resolution'` on
   EVERY entry — including +1.85pp. PLoT honours the producer's label
   (`mapIslFactorEvpi`), so promoting the flag in prod TODAY would deliver
   below-resolution labels with NO numeric EVPI on this wire — not the
   numeric counterfactual ranking the promotion was expected to provide.
3. **Implication**: P-5 is not just "flip when comfortable" — it needs an
   ISL-side answer first (is the blanket below-resolution classification at
   n=500 intended, or over-conservative?). Until then prod-ON would trade a
   sometimes-zero heuristic for an always-labelled, never-numeric surface.

## 5. Residual risks / deliberate stops

- **Flip-probe ISL calls are not generation-asserted** (threshold analysis /
  flip searches). They feed `threshold_analysis` only; per-probe warnings
  would spam one warn per probe. If the primary call is asserted the same
  deploy serves the probes. Deliberate stop, not an oversight.
- **`ISL_MIN_WIRE_GENERATION` is documentation + warning payload, not an
  ordinal gate** — SHAs cannot be compared. The real teeth are the location
  probes; a future ISL build that keeps the locations but changes semantics
  would pass (that class is what the contract fixture refresh is for).
- **§2.2 deletion, not remap**: the CEE orchestrator no longer receives any
  identifiability-derived confidence factor. Remapping `validation_status` →
  `identifiability.status` (B1.5) would ADD a new CEE-facing block on live
  runs — product decision, queued rather than smuggled in.
- **/v1/run legacy validation reads** (`isl_validation?.status`,
  `routes/v1/run.ts:1075,1349`) left as-is per spec §2.2 — V1 surface,
  retire with the routes.
- **P-5 stays prod-OFF** — evidence in §4; Paul-gated.
- The known-open PLoT→CEE enrichment passthrough (`z.record`, untyped) is
  unchanged by this lane.
- Known always-red CI on this repo (pre-existing, not lane-related): `audit`
  (fast-uri/fastify advisories) and `gates (windows-latest)` (invalid path
  `tools/sdk-smoke:python.mjs`).
