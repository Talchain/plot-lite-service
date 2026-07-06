# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.13.1.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.13.1,
replacing the previous GitHub Packages registry pin (`0.2.1`). This
removes the `GITHUB_TOKEN` requirement for installing the schemas
package and brings PLoT onto the same vendored-tgz pattern as CEE/DGAI.

**Provenance:** built from `~/Documents/GitHub/olumi-schemas` at commit
`e1d8d5b960db72ee99091a07ca680ccb3734282a` (package version 0.13.1) via
`npm install && npm run build && npm pack` in a clean detached worktree.
Lint (`tsc --noEmit`) and the full schema test suite (591 tests) passed
at pack time.

**Checksum:** `vendor/talchain-schemas-0.13.1.tgz.sha256` holds the
canonical sha256 of the tarball bytes
(`9e596e2a8d4f95bfb0df641bde3591b59fd7a24d1cff7b9ce09096209faff6b5`).
Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.13.1.tgz\n' \
  "$(cat vendor/talchain-schemas-0.13.1.tgz.sha256)")
```

**Consumed-surface analysis (0.2.1 → 0.13.1):** every dist module that
backs a symbol PLoT imports is byte-identical between 0.2.1 and 0.13.1
(`limits`, `analysis`/`enums`, `cee-errors`, `plot-errors`, `repairs`),
except `graph.*`, whose only delta is a purely additive appended export
(`TopologyPlanSchema` / `TopologyPlan`) that PLoT does not consume.
`index.*` differs only by re-exporting the many new 0.3–0.13 modules.
Runtime adoption fixtures live in `tests/schema-adoption-0.13.1.test.ts`;
the pre-existing `tests/schema-adoption.test.ts` is unchanged and green
on 0.13.1.

**Rollback path:** revert the re-vendor commit. Git history restores the
registry pin (`"@talchain/schemas": "0.2.1"`), the prior
`package-lock.json`, and removes `vendor/`. Re-run `npm install`
(requires `GITHUB_TOKEN` for the GitHub Packages registry, per `.npmrc`).

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
