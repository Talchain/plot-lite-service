# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.31.0.tgz`

**Purpose:** consumption of `@talchain/schemas` v0.31.0 (ROADMAP 2.258 goal
probability, 0.30.0 → 0.31.0). The bump carries **three** additions PLoT needs,
all verified in the tarball rather than argued from the release notes:

| # | addition | location in this tarball | what it unblocks here |
|---|----------|--------------------------|-----------------------|
| 1 | `goal_threshold_frame: z.enum(['level','delta']).optional()` on `NodeV3` | `dist/graph.js:194` | PLoT can FORWARD a producer-stamped frame to ISL beside `goal_threshold` (`translator-v3.ts`). PLoT never mints one. |
| 2 | `EnrichmentFlipThresholdSchema.direction` relaxed `z.string()` → `z.string().optional()` | `dist/boundary/enrichment.js:499` (was `:473` at 0.30.0) | attested no-flip rows can **omit** `direction` instead of emitting the `'none'` placeholder |
| 3 | `no_flip_in_range: z.boolean().optional()` | `dist/boundary/enrichment.js:529` | the structural no-flip signal PLoT already emits (2.228-F3) becomes TYPED rather than a `.passthrough()` rider |

Addition 2 retires a documented compromise. At 0.30.0 `direction` was a REQUIRED
`z.string()`, so omitting it made PLoT's own enrichment egress guard stamp
`enrichment_contract_ok: false` and raise `ENRICHMENT_CONTRACT_MISMATCH` on every
run carrying an attested no-flip — a false alarm on an honest row. `'none'` was
threaded through the open vocabulary to dodge that alarm, with the follow-up
rowed in `m1-review-types.ts`. 0.31.0 is that follow-up's precondition.

**Provenance:** this is the **published registry artifact** for
`@talchain/schemas@0.31.0` (GitHub Packages `npm.pkg.github.com`), tag `v0.31.0`
= commit `1454f6324f0f2d5c031b198e37d961ca807ab3d5`. Downloaded from the registry
tarball URL, **not** a local `npm pack` (which is not byte-reproducible across
environments).

- **sha256** `a9efa0fdb390faed86e53867024141cd86813b5d33379c2d21cb213b612de1ad`
- **npm integrity** `sha512-hdsteWcP15viFlgYi7HDQaUt17Zu72AU95BW2Ao1OH0smhCmGywyIfiJYwCloHjaJtGpBVBrtRc2gScuGsqaIw==`
  (= the lockfile pin; `npm ci` enforces it against these bytes)
- **size** 290,759 bytes

**Registry-identity — derived, three independent agreements (2026-08-01):**

| # | check | result |
|---|-------|--------|
| 1 | registry `dist.shasum` for 0.31.0 vs `shasum -a 1` of these bytes | `bfd68db40b2e38af22e91a4b151b094ac8b31449` — **identical** |
| 2 | registry `dist.integrity` vs `openssl dgst -sha512 -binary … \| base64` | `sha512-hdsteWcP15vi…` — **identical** |
| 3 | that same string vs this repo's `package-lock.json` `integrity` | **identical** (so `npm ci` re-verifies the registry bytes on every install) |

**⚠ BYTE-IDENTITY WITH CEE/DGAI IS NOT YET ESTABLISHED FOR 0.31.0 — and that is a
STATE, not an oversight.** For 0.30.0 this README could show a five-way agreement
because CEE and DGAI had already vendored the same git blob. Measured 2026-08-01,
**both CEE `staging` and DGAI `staging` still vendor 0.30.0**
(`talchain-schemas-0.30.0.tgz`, blob `416a591720a77f31342fae9c4be9036d8fad97d3`,
265,222 bytes, in both). PLoT is therefore the **FIRST** consumer on 0.31.0, and
the cross-repo invariant is *pending*, not *broken*. What replaces it until they
land is checks 1–3 above: the bytes here are provably the REGISTRY's bytes, so
any repo that later vendors the same published artifact converges on them by
construction. **Whoever vendors 0.31.0 into CEE or DGAI should download the same
registry tarball and confirm sha256 `a9efa0fd…` before adding a row here.**

**Checksum:** `vendor/talchain-schemas-0.31.0.tgz.sha256` holds the sha256 of
the tarball bytes. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.31.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.31.0.tgz.sha256)")
```

**Consumed-surface analysis (0.30.0 → 0.31.0): measured, not inspected.** The
0.30→0.31 span is additive-or-relaxing for every symbol PLoT imports — addition 2
WIDENS an accepted set (a previously-required field became optional), which
cannot reject an input the old schema accepted. Rather than rest on that
argument, the re-vendor was measured on this branch:

- `npx tsc -p tsconfig.json --noEmit` — **exit 0** on the re-vendor commit alone,
  so no imported symbol was deleted or narrowed incompatibly **across `src/`**.

  ⚠ **AND ONLY `src/` — the 0.30.0 note above this one claimed "`src/` *and*
  `tests/`", and that was FALSE.** Derived at this tip, not assumed:
  `tsconfig.json:18` reads `"include": ["src/**/*.ts", "src/**/*.d.ts"]`, so the
  repo's `typecheck` script and pre-push check 2 **never look at `tests/`**. A
  re-vendor that breaks a test's TYPES passes both gates silently; only the
  vitest run catches it, and only where the break is also a runtime error. This
  is the same shape as the CEE trap the estate already documents (an honest gate,
  honest about its declared scope, believed to cover more than it does) — **ask
  what a config EXCLUDES, not just what it includes.** Measured consequence on
  this very PR: retiring the `NO_DIRECTION` export left three test files
  importing a symbol that no longer exists, and `tsc` stayed exit 0 throughout.
  The vitest suite is what found them.
- the full vitest suite was run against a **pristine-tip control** (0.30.0) and
  against this branch, and the failure delta is reported in the PR body. The
  re-vendor's own expected deltas are the `file:`-policy check (until the new
  tarball is `git add`-ed) and the derived installed-version assertion.

**Note on the version assertion:** it is not a hard-coded literal.
`tests/schema-adoption-0.13.1.test.ts` DERIVES the expected version from the
`file:` specifier in `package.json` and asserts three-way agreement
(specifier == tarball on disk == installed manifest), so this re-vendor cannot
leave a stale literal behind, and a bumped filename with an unrefreshed lockfile
FAILS LOUD instead of silently running the older contract.

**Rollback path:** revert the re-vendor commit. Git history restores the 0.30.0
tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`. **Note the coupling:** the `direction`-omission change
(ROADMAP 2.258 part 2) DEPENDS on addition 2, so reverting this re-vendor alone
would re-arm `ENRICHMENT_CONTRACT_MISMATCH` on attested no-flip rows. Revert the
whole PR, not this commit in isolation.

**How to update:**

⚠ **Take the PUBLISHED REGISTRY ARTIFACT, not a local `npm pack`.** This recipe
used to say `npm pack`, which contradicts the provenance rule two sections up:
`npm pack` is **not byte-reproducible across environments**, so every repo that
packed its own copy would vendor different bytes and the cross-repo byte-identity
invariant could never be checked. Download what the registry actually serves —
then all consumers converge by construction.

```bash
# 0. Publish the new version from olumi-schemas first (that repo's own release flow).
export GITHUB_TOKEN="$(gh auth token)"     # needs read:packages
V=0.31.0

# 1. Resolve the registry's own tarball URL + expected hashes for that version
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://npm.pkg.github.com/@talchain/schemas \
  | python3 -c "import json,sys,os; d=json.load(sys.stdin)['versions'][os.environ['V']]['dist']; print(d['tarball']); print(d['shasum']); print(d['integrity'])"

# 2. Download it into vendor/ and refresh the sha256 manifest
curl -sSL -H "Authorization: Bearer $GITHUB_TOKEN" "<tarball-url-from-step-1>" \
  -o vendor/talchain-schemas-$V.tgz
shasum -a 256 vendor/talchain-schemas-$V.tgz | awk '{print $1}' \
  > vendor/talchain-schemas-$V.tgz.sha256

# 3. VERIFY the bytes are the registry's before trusting them (all three must match step 1)
shasum -a 1 vendor/talchain-schemas-$V.tgz                                  # == dist.shasum
openssl dgst -sha512 -binary vendor/talchain-schemas-$V.tgz | base64        # == dist.integrity (minus 'sha512-')

# 4. Update the package.json `file:` reference, then `npm install`
#    (confirm package-lock.json's integrity now equals dist.integrity)
# 5. git rm the old tarball + .sha256; git add the new pair; update this README
```

Only the currently-pinned version lives in `vendor/` — old tarballs are
removed on each bump.

**Removal criterion:** delete this directory and switch `package.json`
back to a registry version once `olumi-schemas` is published to a
registry all consumers can reach. Until then, every consuming repo
carries its own `vendor/` copy.
