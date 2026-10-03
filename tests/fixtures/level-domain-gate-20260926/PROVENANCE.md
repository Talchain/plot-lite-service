# `older-isl.base-response.json` — provenance

The `/v2/run` response PLoT returned at **`71ab168f0e6108aa3c03d05eb09c1468adf46883`**
(PLoT #370, Fix 2 — the base of the release-gate (ii) branch) for the
"older ISL" row of `tests/constraint-level-domain-gate.route.test.ts`: Paul's
churn shape, his three options and numbers, ISL mocked WITHOUT
`level_out_of_domain_fraction` (an ISL build older than #181).

## How it was produced

At `71ab168` with no `src/` change, a temporary spec (not committed) copied the
harness of `constraint-level-domain-gate.route.test.ts` verbatim (same mock,
same `paulsShape()`, same `stable()`), POSTed the scenario **twice**, asserted
`stable(a)` deep-equals `stable(b)` while the raw bodies differ, and wrote
`stable(a)` here. `stable()`'s volatile-key list was derived from that same
two-run diff (38 differing leaves: timings, wall-clock stamps, the request id
and its echoes, the random critique UUID and the fact hashes derived from it).
The committed `stable()` also drops the build identity (`build`, `plot_build`:
HEAD's short SHA, `71ab168` in these bytes), on both sides at compare time — the
first run after the commit showed it moving and nothing else with it.

## What the committed row compares

Everything except the three hashes that canonicalise the ISL **request**
(`response_hash`, `graph_hash`, `response_content_hash`): the request now
carries `level_domain`, so they move by design. The row asserts they move.

**Hand-edited 28 Sep 2026 (PLoT #388, AIQ #72 5867389636, not re-recorded):** `decision_brief.what_would_change`
`["Monthly logo churn", "Annual delivery cost"]` → `[]`. This older-ISL capture carries no fragile edge, no found flip
and no resolved `factor_evppi`, so nothing was MEASURED to change the leader. No other field moved (the CONTROL test's
full-body equality is the proof).

**R5-2 (2026-09-28, R&C, R5 handed by MG #72 5871363476):** `older-isl.base-response.json` was HAND-EDITED, not re-recorded. DOMINANT_FACTOR now names a factor only when ISL MEASURED its EVPPI above resolution (#389's gate). This scenario's ISL response resolves no EVPPI for `fac_churn`, so two entries leave:
- `"One factor dominates. What would change if Monthly logo churn had less influence?"` from `m1_coaching.model_critiques`;
- the same entry from `decision_brief.warnings`.
The diff is exactly those two entries (+1/−16 lines). No option row, probability, label, id or ordering moved.

**PLoT #409 (2026-09-29, R3-B, DL #72 5883188906): HAND-EDITED, not re-recorded.** Coaching prints a confidence only when ISL MEASURED the factor's stability (`confidence_source: plot_unified_from_isl_bootstrap`). This older-ISL scenario's factors carry PLoT's graph-only confidence (0.5), so:
- the two evidence gaps (`Monthly logo churn`, `Annual delivery cost`) lose `confidence_display: "50%"`, gain `confidence_defaulted: true` and the "not measured" note, and their suggestion says "has not been measured" instead of "is low";
- the top driver's confidence is no longer read as a measured LOW, so `LOW_DRIVER_CONFIDENCE` leaves `readiness_reasons`. The existing missing-data rule keeps `INSUFFICIENT_SIGNALS`, and `readiness_tone` goes `caution` → `tempered` (one hard reason left, not two). This is flagged to AIQ as a meaning call.

The path-level diff of the actual body against this file was reviewed leaf by leaf. Every other differing leaf is one `stable()` or `withoutRequestHashes()` drops (build, timings, request ids, uuids, hashes). The CONTROL test's full-body equality is the proof.
- **AIQ cap (#72 5883542574):** an unmeasured top-driver confidence never yields the `confident` tone. `readiness_reasons` gains the soft `TOP_DRIVER_UNMEASURED` (third element). The tone stays `tempered` and the copy is unchanged here, because a higher-priority reason leads it. This was re-derived by the same leaf-by-leaf diff; it is the only non-volatile leaf that moved.

**Ledger `audience` (2026-09-29, R3-B, AIQ #72 5884364585, DL 5884241382): HAND-EDITED, not re-recorded.** Every assumptions-ledger row now carries a typed `audience`. Both rows here are `plot_normaliser` diagnostics, so both are `"audience": "internal"`, and the ledger gains `"user_count": 0` and `"user_high_impact_count": 0`. The diff is exactly those four leaves (+7/−3 lines). The CONTROL test's full-body equality is the proof.
