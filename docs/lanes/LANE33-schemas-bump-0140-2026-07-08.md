# LANE 33 — @talchain/schemas 0.13.1 → 0.14.0 (enrichment v1 adoption, rollout step 3)

Date: 2026-07-08
Branch: `claude-lane33/schemas-bump-0140` (base `origin/staging` 41c2f3c — includes LANE29/PR #206)
Spec of record: olumi-schemas `main` @ 5612e2666 —
`docs/enrichment-v1/ROLLOUT.md` step 3 + `contract-tests/README.md` §PLoT lane.
Ordering precondition: CEE (rollout step 2, first consumer) is MERGED + DEPLOYED
before this lane — satisfied at dispatch time.

## 1. What landed (commit by commit)

| Commit | Spec item | Change |
|---|---|---|
| c9a8ac2 | ROLLOUT step 3 (pin mechanics) | `vendor/talchain-schemas-0.14.0.tgz` + `file:` pin + lockfile + sha256 manifest; 0.13.1 tarball/manifest removed; `vendor/README.md` updated; `tests/schema-adoption-0.13.1.test.ts` installed-version proof moved to 0.14.0 (all consumed-surface fixtures deliberately unchanged — passing on 0.14.0 is part of the proof) |
| deee050 | README §PLoT lane step 4 | Producer-side assertion in `tests/enrichment-emission-contract.test.ts`: buildResponse output (the `/v2/run` body CEE persists byte-for-byte as `RunAnalysisHandlerFact.result.enrichment`) must `safeParse` against `AnalysisEnrichmentSchema` from `@talchain/schemas/boundary`. Asserted on BOTH route-level emissions (mixed-case fixture + constraints-bearing variant, PR #203–#205 vocabulary). Also resolves the lane-29 deferral note in `tests/contract/isl-to-plot.contract.test.ts` (see §3) |
| (this commit) | — | Lane doc |

## 2. Tarball provenance — independently verified twice

- Built from olumi-schemas `main` @ 5612e2666 via `npm ci && npm run
  prepublishOnly && npm pack` (prepublish gate: 646 schema tests green).
- sha256 `4e4915552a36654b7736eb56d42740e44b5c655209b606882782c55aff749767`:
  - MATCHES the CEE adoption lane's recorded tarball byte-for-byte (rollout
    step 2's vendored artefact) — required by the lane brief;
  - REPRODUCED independently in this session: a fresh clone at 5612e2666,
    `npm ci && npm run prepublishOnly && npm pack`, hashed to the identical
    value (2026-07-08, this machine).
- 0.14.0 is additive over 0.13.1 (enrichment envelope only — no transport
  field or strictness change on any symbol PLoT consumes); the unchanged
  consumed-surface fixtures in `tests/schema-adoption-0.13.1.test.ts` passing
  on 0.14.0 is the runtime proof.

## 3. README §PLoT lane — item-by-item disposition

| Step | Disposition |
|---|---|
| 1. Copy `isl-to-plot.contract.test.ts` → `tests/contract/` | ALREADY INSTALLED by lane 29 (base 41c2f3c), parameterised over both verified captures (20260707 + 20260708), 30 pins green |
| 2. Point fixture at repo's own capture | Done by lane 29 (raw captures; no `.response` unwrap) |
| 3. Swap schema import to `@talchain/schemas/boundary` | N/A IN THAT FILE — the reference spec imports no schema (the ISL response has no boundary schema; `AnalysisEnrichmentSchema` types the PLoT→CEE envelope, not the ISL wire). The stale lane-29 deferral note was resolved to say exactly this. The 0.14.0 boundary import lives in `tests/enrichment-emission-contract.test.ts` |
| 4. Producer-side `safeParse` assertion in `tests/enrichment-emission-contract.test.ts` | DONE (deee050) — see teeth check below |
| 5. Refresh ISL fixture on material ISL build change | Not triggered this lane (no ISL redeploy); method remains the fixture dir's `PROVENANCE.md` |

## 4. Assertion teeth (mutation-verified)

`AnalysisEnrichmentSchema` is passthrough + all-optional, so the assertion is
GREEN on conforming output by design — teeth were demonstrated by mutation
(session-run, not committed):

- `{ analysis_status: 'bogus_status' }` → safeParse FAILS (malformed known enum);
- `{ option_comparison: [{ option_id: 'o1', win_probability: 'high' }] }` →
  safeParse FAILS (malformed nested known key);
- `{ some_future_key: {...} }` → safeParse PASSES (passthrough preserved —
  additive producer evolution does not trip the test).

Live `/v2/run` output parsed green on first run (both emissions) — i.e. the
current producer already conforms; the assertion is a tripwire for future
malformed-known-key regressions, not a behaviour change. No production code
was modified in this lane.

## 5. Gates (run in this worktree)

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npm test` (full suite via `tools/run-all-tests.js`) — green (see PR body
  for the run summary).
- `bash scripts/pre-push-validate.sh` — full pre-push gate; the final push ran
  the Husky hook (not `--no-verify`).
- Known always-red CI on every PR (pre-existing, unrelated): `audit`
  (fast-uri/fastify advisories) + `gates (windows-latest)` (invalid path
  `tools/sdk-smoke:python.mjs`).

## 6. Rollout position + what this lane deliberately did NOT do

- Order: step 2 CEE (merged + deployed) → **step 3 PLoT (this lane)** → step 4
  UI → (step 5 ISL: no TS pin). UI may not emit `generate_model` /
  `explicit_generate` until CEE ≥ 0.13.1 is deployed — satisfied by step 2.
- No production code change: PLoT does not (yet) import enrichment types in
  `src/`; this lane is pin + contract-surface only. Opting `src/` into the
  typed envelope is future work, not blocked by anything here.
- The PLoT→CEE `z.record` passthrough at CEE ingress is NOT closed by this
  lane (known-open seam); this lane adds the producer-side tripwire so a
  malformed known key fails in PLoT CI before it reaches that seam.
- Reserved staging scenarios (1909b083*, def3cb31*, 8e0bf73d*, 90385279*,
  104d65bd*) untouched; no staging captures were taken this lane.
