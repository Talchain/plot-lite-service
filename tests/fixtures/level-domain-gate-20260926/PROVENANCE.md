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
