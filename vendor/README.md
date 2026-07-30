# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.30.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.30.0
(ROADMAP 2.160 contract alignment, 0.22.0 → 0.30.0). The bump exists to make
the **four VOI enrichment keys VALIDATABLE at PLoT's egress**, not merely
forwarded: `correlation_model`, `decision_evpi`, `factor_evppi` and
`p_win_sensitivity` are emitted by ISL, forwarded verbatim by
`islEnrichmentPassthrough` (`src/routes/v2/run-contract-keys.ts`) as top-level
`/v2/run` keys, and parsed by the egress guard against
`AnalysisEnrichmentSchema`. **At 0.22.0 that schema contained ZERO of the four**
(measured: 0 occurrences of each across the whole tarball) and it is
`.passthrough()`, so `decision_evpi: 'NOT-A-NUMBER'` parsed CLEAN and the guard
still stamped `_meta.evidence.enrichment_contract_ok: true` — the disclosure
field asserted a validation that never happened for these keys. 0.30.0 types
them (`decision_evpi` as `z.number().nullable().optional()`, `factor_evppi` as
an array of `EnrichmentFactorEvppiEntrySchema`, the two ISL-owned members as
array/object rather than "anything"), so the guard that was already running now
actually sees them. Pinned by `tests/contract/voi-enrichment-typed.test.ts`.

**Provenance:** this is the **published registry artifact** for
`@talchain/schemas@0.30.0` (GitHub Packages `npm.pkg.github.com`), tag
`v0.30.0` = commit `f5815a3425643f7fa1bcf759807085b71a19357d`
(*"0.30.0 — the VOI family joins the CEE→UI keep-list (V7-C slice 1a)"*, schemas
PR #29). **These are the SAME BYTES CEE and DGAI vendor** — not a local
`npm pack` (which is not byte-reproducible across environments). Obtained by
reading the vendored blob already committed on CEE `staging` and DGAI `staging`,
which are the same git blob.

- **sha256** `cd3746369b26da20e079c8d8ec323294edcc46a32df6830b657aed2cd465a0cc`
- **npm integrity** `sha512-6qF6M0Gkt6/WQ4/2nxZWU0hau93g/fhH4+0c/3mZTA+I5U8LY9mxLjZsgf980cPbjYJeBEKwdbMUX9HQhCXmrg==`
  (= the lockfile pin; `npm ci` enforces it against these bytes)

**Byte identity with CEE/DGAI — derived, five independent agreements (2026-07-30):**

| # | check | result |
|---|-------|--------|
| 1 | CEE `vendor/talchain-schemas-0.30.0.tgz` @`staging` git blob sha | `416a591720a77f31342fae9c4be9036d8fad97d3` (265,222 bytes) |
| 2 | DGAI `vendor/talchain-schemas-0.30.0.tgz` @`staging` git blob sha | `416a5917…` — **the identical blob** |
| 3 | sha256 of the bytes vendored here | `cd374636…` = **both** repos' committed `.tgz.sha256` manifests |
| 4 | `openssl dgst -sha512 -binary … \| base64` of these bytes | `6qF6M0Gkt6/…` = this repo's `package-lock.json` `integrity` |
| 5 | CEE `pnpm-lock.yaml` @`staging` integrity for 0.30.0 | `6qF6M0Gkt6/…` — **identical string** |

So the artifact PLoT resolves is provably the artifact CEE resolves on staging.
The "matches CEE byte-for-byte" invariant HOLDS for 0.30.0.

**Checksum:** `vendor/talchain-schemas-0.30.0.tgz.sha256` holds the sha256 of
the tarball bytes. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.30.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.30.0.tgz.sha256)")
```

**Consumed-surface analysis (0.22.0 → 0.30.0): proven inert for PLoT
EMPIRICALLY, not by inspection.** The 0.23–0.30 span is additive for every
symbol PLoT imports. Rather than re-argue symbol-by-symbol (the 0.15→0.22 note
did, and an argued claim is only as good as its author's completeness), this
re-vendor was measured:

- `npx tsc --noEmit` (pre-push check 2/7) — **exit 0**, so no imported symbol
  was deleted or narrowed incompatibly across `src/` **and** `tests/`.
- `npm test` (pre-push check 3/7) — **6,376 tests, 583 files.** The ONLY
  behaviour deltas were the two the re-vendor is supposed to cause: the
  `file:`-policy check (until the new tarball was `git add`-ed) and the
  installed-version assertion. Zero other tests changed verdict, including the
  enrichment/adoption fixtures that exist to catch exactly this
  (`tests/schema-adoption.test.ts`, `tests/schema-adoption-0.13.1.test.ts`,
  `tests/enrichment-emission-contract.test.ts`,
  `tests/enrichment-contract.fixtures.test.ts`,
  `tests/contract/isl-to-plot.contract.test.ts`,
  `tests/decision-record.passthrough-parity.test.ts`).

**Note on the version assertion:** it is no longer a hard-coded literal.
`tests/schema-adoption-0.13.1.test.ts` now DERIVES the expected version from the
`file:` specifier in `package.json` and asserts three-way agreement
(specifier == tarball on disk == installed manifest), so a future re-vendor
cannot leave a stale literal behind, and a bumped filename with an unrefreshed
lockfile FAILS LOUD instead of silently running the older contract.

**Rollback path:** revert the re-vendor commit. Git history restores the 0.22.0
tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`.

**How to update:**

```bash
# 1. Rebuild + pack the schemas package (bump version there first if contents changed)
cd ~/Documents/GitHub/olumi-schemas
npm run build && npm pack   # produces talchain-schemas-<version>.tgz
# 2. Replace the vendored copy here and refresh the sha256 manifest
cp talchain-schemas-<version>.tgz /path/to/plot-lite-service/vendor/
shasum -a 256 /path/to/plot-lite-service/vendor/talchain-schemas-<version>.tgz \
  | awk '{print $1}' \
  > /path/to/plot-lite-service/vendor/talchain-schemas-<version>.tgz.sha256
# 3. Update the package.json `file:` reference, then `npm install`
# 4. Delete the old tarball + .sha256; update this README
```

Only the currently-pinned version lives in `vendor/` — old tarballs are
removed on each bump.

**Removal criterion:** delete this directory and switch `package.json`
back to a registry version once `olumi-schemas` is published to a
registry all consumers can reach. Until then, every consuming repo
carries its own `vendor/` copy.
