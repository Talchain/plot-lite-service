# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.14.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.14.0
(enrichment v1 — typed analysis-enrichment envelope + wire-shape contract
pack; see `docs/enrichment-v1/ROLLOUT.md` in the schemas repo). Adopted
as rollout step 3 (PLoT lane), after the CEE lane (step 2) closed the
0.13.0/0.13.1 skew. Keeps PLoT on the vendored-tgz pattern shared with
CEE/DGAI (no `GITHUB_TOKEN` needed to install).

**Provenance:** built from `~/Documents/GitHub/olumi-schemas` `main` at
commit `5612e2666` via `npm ci && npm run prepublishOnly && npm pack` in
a clean detached worktree. The prepublish gate (build + full schema test
suite, 646 tests) passed at pack time. The tarball sha256 matches the
one recorded by the CEE adoption lane byte-for-byte
(`4e4915552a36654b7736eb56d42740e44b5c655209b606882782c55aff749767`).

**Checksum:** `vendor/talchain-schemas-0.14.0.tgz.sha256` holds the
canonical sha256 of the tarball bytes. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.14.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.14.0.tgz.sha256)")
```

**Consumed-surface analysis (0.13.1 → 0.14.0):** 0.14.0 is additive over
0.13.1 — it adds the opt-in `@talchain/schemas/boundary` enrichment
envelope (`AnalysisEnrichmentSchema`, `CEE_UI_ENRICHMENT_KEEP_LIST`, ...)
and changes no transport field or strictness that PLoT consumes. PLoT
opts in on the producer side: `tests/enrichment-emission-contract.test.ts`
asserts `buildResponse` output parses against `AnalysisEnrichmentSchema`,
and `tests/contract/isl-to-plot.contract.test.ts` pins the ISL→PLoT V2
envelope field locations.

**Rollback path:** revert the re-vendor commit. Git history restores the
0.13.1 tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`. (The pre-0.13.1 registry-pin era — `0.2.1` +
`GITHUB_TOKEN` via `.npmrc` — is two bumps back in history.)

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
