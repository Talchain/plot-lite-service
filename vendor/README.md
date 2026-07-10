# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.15.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.15.0
(the six-part additive wave: `reasoning` sidecar, `held_proposal` +
`ui_directive` block kinds, `selection_change` system event,
`selected_elements` turn-payload field, and the standalone
`DecisionRecordSchema` — ROADMAP 3.1's contract half). Adopted by the
Platform lane the same day CEE adopted it (CEE PR #405). Keeps PLoT on
the vendored-tgz pattern shared with CEE/DGAI (no `GITHUB_TOKEN` needed
to install).

**Provenance:** built from `~/Documents/GitHub/olumi-schemas` at tag
`v0.15.0` (= main `b02ba48`) via `npm ci && npm run prepublishOnly &&
npm pack` in a clean detached worktree; the prepublish gate (build +
full schema test suite) passed at pack time. The tarball sha256 matches
CEE's vendored copy byte-for-byte
(`50cc1e0c4d5fcab11cd75417c458dad17e7033760c9f4d30d50329a4b946f19f`).

**Checksum:** `vendor/talchain-schemas-0.15.0.tgz.sha256` holds the
canonical sha256 of the tarball bytes. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.15.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.15.0.tgz.sha256)")
```

**Consumed-surface analysis (0.14.0 → 0.15.0):** proven additive (zero
removed/renamed/tightened symbols; CI green on the schemas head). New
symbols PLoT consumes: `DecisionRecordSchema` /
`DecisionRecordAnalysisSummarySchema` from `@talchain/schemas/boundary`
— pinned by `tests/decision-record.passthrough-parity.test.ts`
(DDL↔wire pass-through parity with the Supabase `decision_records`
migration) and `tests/decision-brief.analysis-summary.test.ts` (the
flag-gated `decision_brief.analysis_summary` capture surface). All
previously-consumed surfaces are re-proven by the unchanged fixtures in
`tests/schema-adoption-0.13.1.test.ts`,
`tests/enrichment-emission-contract.test.ts`, and
`tests/contract/isl-to-plot.contract.test.ts`.

**Rollback path:** revert the re-vendor commit. Git history restores the
0.14.0 tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`. (The pre-0.13.1 registry-pin era — `0.2.1` +
`GITHUB_TOKEN` via `.npmrc` — is three bumps back in history.)

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
