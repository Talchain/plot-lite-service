# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree. This
mirrors the convention already used by `olumi-assistants-service` (CEE)
and `DecisionGuideAI` (UI).

## Current contents

### `talchain-schemas-0.37.0.tgz`

**Purpose:** consumption of `@talchain/schemas` v0.37.0 (0.31.0 → 0.37.0, a
SIX-MINOR jump taken in one step). Unlike the 0.30→0.31 bump below, this one was
not taken to unblock a specific PLoT field — it was taken to close a six-version
skew, which is the estate's dominant boundary hazard: a consumer on an older pin
**silently drops** fields it does not know.

The span is **additive for every symbol PLoT imports**, derived from the source
diff rather than the release notes:

| version | what it added | does PLoT import it? |
|---------|---------------|----------------------|
| 0.32.0 | `ui_directive` panel/section verbs | no |
| 0.33.0 | `TransportedCritiqueSchema`; `EnrichmentCritiqueSchema` unchanged, `critiques` widened to a **union** of the two | yes — via `AnalysisEnrichmentSchema`; a widened union cannot reject an input the old schema accepted |
| 0.34.0 | `edge_adjudication` + `prior_range_edit` P4 transport events | no |
| 0.35.0 | classed field-parity table + tool op-batch | no |
| 0.36.0 | editable-field table revision 2 (edge `validation` row) | no |
| 0.37.0 | `ExerciseBlock.dsk_provenance` atomic triple | no |

`git diff v0.31.0..v0.37.0 -- src/boundary/enrichment.ts` is **purely additive**:
one new schema plus the `critiques` union widening. `EnrichmentOutcomeStatsSchema`
is **byte-for-byte unchanged across the whole span** — which matters, see the
open follow-on below.

**⚠ OPEN, AND DELIBERATELY NOT PAPERED OVER (ROADMAP 2.581).**
`EnrichmentOutcomeStatsSchema` (`dist/boundary/enrichment.js:118-127`) still
declares `mean`/`p10`/`p50`/`p90` as REQUIRED `z.number()`. It therefore does not
model the honest-absence shape ISL has emitted since its own 2.477 — a degenerate
Monte-Carlo run whose `outcome` carries the sample census but no percentiles.
PLoT now carries that partial block (2.581), so on a degenerate option the
enrichment egress guard stamps `enrichment_contract_ok: false` and raises
`ENRICHMENT_CONTRACT_MISMATCH`. **That alarm is TRUE and is intentionally left
armed:** the alternative is fabricating a `mean`, which is the defect class the
guard exists to catch. Note this is the exact inverse of the 0.30→0.31 story
below, where a required field was relaxed to retire a false alarm — here the
alarm is honest and the schema is what must move. Schemas follow-on: make those
four `.optional()` and declare
`percentiles_source: z.enum(['samples','unavailable']).optional()`.

**Provenance:** packed from source — `npm pack` on a clone of `olumi-schemas`
`main` @ `685d92ec49b3caf14e1086a2a0c94a5cc50f95ea`, tag `v0.37.0`.

- **sha256** `835ab4b8381e1280f239de0d408c2da6790ab9f93a0a14ce6e5a389acd4dd369`
- **npm integrity** `sha512-XlG7r5IudsCs/+69x4HFWTqs0KnUpZDbeBzXfM0OSJOJbpJMN9La+Mi7tkapkqfXoJox/MOlt6I18Sy/XSNDBw==`
  (= the lockfile pin; `npm ci` enforces it against these bytes)
- **size** 347,174 bytes

**⚠ THE PROVENANCE RULE INVERTED AT 0.37.0 — READ THIS BEFORE THE NEXT BUMP.**
The 0.31.0 section below, and the "How to update" recipe further down, both say
to take the **published registry artifact** and explicitly warn against
`npm pack`. For 0.37.0 that is **WRONG**, and the reason is measured, not
theoretical: the GitHub Packages artifact for 0.37.0 carries a **different
envelope** — same source tree, different gzip framing — and hashes to
`45264dc6…`, not `835ab4b8…`. The two must never be mixed in the same estate,
because every consumer's `package-lock.json` integrity is computed over the bytes
it vendored. **The canonical 0.37.0 bytes are the packed-from-source ones above.**

Both rules exist for the same goal — every consumer converging on identical
bytes — and neither is safe on its own; what makes a bump correct is that ALL
consumers use the SAME recipe and assert the SAME sha256 before trusting it.
The canonical sha256 is the invariant; the recipe is just how you reach it.
**Assert `835ab4b8…` on whatever you produce, and if it does not match, stop —
do not vendor bytes you cannot name.**

**⚠ CROSS-REPO BYTE-IDENTITY IS NOT ESTABLISHED FOR 0.37.0 — a STATE, not an
oversight.** Measured this session: **CEE `staging` vendors 0.35.0**
(`package.json:91`, `file:./vendor/talchain-schemas-0.35.0.tgz`). PLoT is again
the FIRST consumer on this version, so the cross-repo invariant is *pending*.
Whoever vendors 0.37.0 into CEE or DGAI should pack from
`main @ 685d92ec`, confirm sha256 `835ab4b8…`, and add a row here.

**Checksum:** `vendor/talchain-schemas-0.37.0.tgz.sha256` holds the sha256 of
the tarball bytes. Verify with:

```bash
shasum -a 256 -c <(printf '%s  vendor/talchain-schemas-0.37.0.tgz\n' \
  "$(cat vendor/talchain-schemas-0.37.0.tgz.sha256)")
```

**Consumed-surface analysis (0.31.0 → 0.37.0): measured, not inspected.**
`npx tsc -p tsconfig.json --noEmit` — **exit 0** on the re-vendor commit alone,
and the full vitest suite was run at this pin; results in the PR/lane report.
Read the `src/`-only caveat below before treating that as full coverage: it is
the reason the vitest run, not the typecheck, is the load-bearing gate for a
re-vendor.

**Historical — consumed-surface analysis (0.30.0 → 0.31.0): measured, not
inspected.** The 0.30→0.31 span is additive-or-relaxing for every symbol PLoT
imports — addition 2 WIDENS an accepted set (a previously-required field became
optional), which cannot reject an input the old schema accepted. Rather than rest
on that argument, the re-vendor was measured on its branch:

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

**Rollback path:** revert the re-vendor commit. Git history restores the 0.31.0
tarball + manifest, the prior `package.json` pin, and the prior
`package-lock.json`. The 0.31→0.37 bump is additive for every symbol PLoT
imports, so unlike the 0.30→0.31 bump it carries **no code coupling** and can be
reverted in isolation. (Historical, for the commit below it: the 0.30→0.31
re-vendor WAS coupled — the `direction`-omission change, ROADMAP 2.258 part 2,
depended on its addition 2, so reverting that one alone would re-arm
`ENRICHMENT_CONTRACT_MISMATCH` on attested no-flip rows.)

**How to update:**

⚠ **PACK FROM SOURCE, and ASSERT THE SHA256. This instruction reversed at
0.37.0 — do not follow the older text without reading why.** This recipe
previously said to take the published GitHub Packages artifact and warned
against `npm pack`. Measured at 0.37.0, the registry artifact and the
packed-from-source artifact are **different bytes** — same source tree,
different gzip envelope (`45264dc6…` vs the canonical `835ab4b8…`). Mixing the
two across repos is the failure this whole section exists to prevent, since each
consumer's `package-lock.json` integrity is computed over the bytes it vendored.

**The durable rule is not "registry" or "pack" — it is: every consumer uses the
SAME recipe and asserts the SAME sha256 before trusting the bytes.** The hash is
the invariant; the recipe is only how you reach it. Whoever bumps next: agree the
canonical hash with the schemas lane FIRST, then reproduce it.

```bash
# 0. Tag + merge the new version in olumi-schemas first (that repo's own release flow).
V=0.37.0
SHA=685d92ec49b3caf14e1086a2a0c94a5cc50f95ea      # the tagged commit
EXPECTED=835ab4b8381e1280f239de0d408c2da6790ab9f93a0a14ce6e5a389acd4dd369

# 1. Pack from a clean clone of the tagged commit (NOT from the registry)
git clone --filter=blob:none https://github.com/Talchain/olumi-schemas.git /tmp/schemas-$V
cd /tmp/schemas-$V && git checkout "$SHA" && [ "$(git rev-parse HEAD)" = "$SHA" ] || exit 1
npm ci && npm run build && npm pack

# 2. ASSERT the bytes before they enter the repo — a mismatch is a STOP, not a warning
ACTUAL=$(shasum -a 256 "talchain-schemas-$V.tgz" | cut -d' ' -f1)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "STOP: got $ACTUAL, expected $EXPECTED"; exit 1; }

# 3. Install into vendor/ and write the manifest
cp "talchain-schemas-$V.tgz" "$OLDPWD/vendor/"
cd "$OLDPWD"
printf '%s\n' "$EXPECTED" > vendor/talchain-schemas-$V.tgz.sha256

# 4. Update the package.json `file:` reference, then `npm install` to refresh
#    package-lock.json's `integrity` over THESE bytes.
# 5. git rm the old tarball + .sha256; git add the new pair (the file-deps policy
#    check FAILS until they are git-tracked — that is the gate working, not a bug);
#    update this README.
# 6. Run the FULL suite, not just the typecheck: tsconfig.json excludes tests/,
#    so a re-vendor that breaks a test's types passes `npm run typecheck` silently.
bash scripts/validate-file-deps.sh .
npm run typecheck && npm test
```

Only the currently-pinned version lives in `vendor/` — old tarballs are
removed on each bump.

**Removal criterion:** delete this directory and switch `package.json`
back to a registry version once `olumi-schemas` is published to a
registry all consumers can reach. Until then, every consuming repo
carries its own `vendor/` copy.
