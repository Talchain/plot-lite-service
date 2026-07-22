# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.22.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.22.0
(ROADMAP 1.62 re-vendor, 0.15.0 → 0.22.0). The 0.16–0.22 span is
additive-only for PLoT (S2 intent vocabulary + `chip.id`, batched
`direct_graph_edit`, the S1 graph-hash CONTRACT surface, typed feedback
events, Group-A compute-seam response schemas, and the F6
enrichment fields `constraint_margins` / `scale_provenance`). Keeps PLoT
on the vendored-tgz pattern shared with CEE/DGAI (no `GITHUB_TOKEN`
needed to install).

**Provenance:** this is the **published registry artifact** for
`@talchain/schemas@0.22.0` (GitHub Packages `npm.pkg.github.com`), tag
`v0.22.0` = main `e04b900c` (the squash-merge of schemas PR #18
`a1/0.22.0-batch`). Fetched via authenticated `npm pack
@talchain/schemas@0.22.0` (read:packages). This is the SAME bytes CEE and
DGAI vendor — the shared canonical copy.

- **sha256** `adf17921456eb024fde429a79e7375d7af27aa14db76b4d720498dc99e5f622d`
- **npm integrity** `sha512-y44YfUUs7RK3pP/lM0kfMMdNwVzQoWrYnUWdnjQTsYZG57yiYqk2+4Etn/FXWOPsGLvDdI9uKmCNUDzopN7biw==`
  (= the lockfile pin; `npm ci` enforces it against these bytes)

> **Byte reconciliation — RESOLVED 22 Jul.** An earlier local rebuild of
> the same tag (`npm ci && npm run build && npm pack`, Node 20.19.5 / npm
> 10.8.2) produced sha256 `c6bc712f…` — **content-identical** to the
> published artifact (per-file diff over all 182 files = zero content
> deltas; the delta was purely the tar/gzip metadata layer, since `npm
> pack` is not byte-reproducible across the CI publish env vs a local
> env). Per A1's ruling the CANONICAL bytes are the **published** artifact
> (independently re-packed to `adf179` by A1 via GitHub Packages, by the
> #634 adversarial from the registry, and by the DGAI lane — three matches,
> and the registry sha512 matches CEE's lockfile). CEE landed these exact
> bytes first (#634, healthz `7ef952c`), so the "matches CEE byte-for-byte"
> invariant now HOLDS for 0.22.0. The prior local rebuild is documented
> here only as the content-identity control; it is NOT vendored.

**Checksum:** `vendor/talchain-schemas-0.22.0.tgz.sha256` holds the
sha256 of the tarball bytes as built. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.22.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.22.0.tgz.sha256)")
```

**Consumed-surface analysis (0.15.0 → 0.22.0):** proven INERT for PLoT
(re-derived at the bytes, 2026-07-22). Every symbol PLoT imports (src +
tests) is byte-identical or additive-only-optional-on-`.passthrough()`;
the `GoalConstraintSchema`→`LegacyGoalConstraintStubSchema` rename (#14)
and all deletions land only on symbols/modules PLoT does not import; the
run-request family gained no fields. New surface CEE/UI adopt is invisible
to PLoT. Re-proven by the unchanged fixtures in
`tests/schema-adoption-0.13.1.test.ts`,
`tests/enrichment-emission-contract.test.ts`, and
`tests/contract/isl-to-plot.contract.test.ts`.

**Rollback path:** revert the re-vendor commit. Git history restores the
0.15.0 tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`. (The pre-0.13.1 registry-pin era — `0.2.1` +
`GITHUB_TOKEN` via `.npmrc` — is several bumps back in history.)

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
