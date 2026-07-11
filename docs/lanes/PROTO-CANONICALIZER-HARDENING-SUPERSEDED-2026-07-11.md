# Lane: proto-canonicalizer-hardening — SUPERSEDED (already merged as PR #194)

- **Date:** 2026-07-11
- **Lane item:** ROADMAP 1.25 wave — `__proto__` prototype-pollution / hash-swallow hardening in the PLoT graph canonicalisers
- **Branch under review:** `claude/proto-canonicalizer-hardening` (tip `2d932ca175ac903d6b9ccbc2b9ab6ed1f16bb41c`)
- **Verdict:** **ALREADY FIXED — the branch is the merged head of PR #194.** No code to land. Do not re-land.

## What the branch fixes

One commit (`2d932ca`, 2026-07-06): seeds the three shared object-canonicalisers with
`Object.create(null)` so an own `__proto__` key (which `JSON.parse` creates as a real own
enumerable property on request bodies) survives canonicalisation instead of being swallowed
by the inherited `Object.prototype` setter on a plain `{}` accumulator. Without the fix, two
payloads differing only by `__proto__` canonicalise identically and collide to one hash
(idempotency-cache replay / response_hash / fact content-address collision).

Files: `src/util/canonical.ts`, `src/util/canonical-json.ts`, `src/facts/hash.ts`,
plus `tests/proto-canonicaliser-hardening.test.ts` (14 tests: collision-gone,
`__proto__`-survival, no-drift golden vs pre-fix behaviour, no-pollution).

## Evidence the hazard is already fixed on staging

All checks run 2026-07-11 against `origin/staging` tip `dd21d62` in a fresh worktree.

1. **The branch merged as PR #194.**
   `gh pr view 194` → state `MERGED`, `headRefName: claude/proto-canonicalizer-hardening`,
   `headRefOid: 2d932ca…` (exactly the branch tip), squash-merge commit
   `da221289bae41bd6e018e6768c6b0a2a7456f07d` into `staging`, merged 2026-07-06T17:42:45Z.
   The branch only *looks* unmerged because squash-merges leave the source branch dangling
   in the commit graph; the remote ref was never deleted after merge.
2. **Branch content is byte-identical on the current staging tip.**
   `git diff 2d932ca origin/staging -- src/util/canonical.ts src/util/canonical-json.ts
   src/facts/hash.ts tests/proto-canonicaliser-hardening.test.ts` → **0 lines**.
   The branch's full diff vs its merge-base (`13c9c43`) touches exactly those 4 files
   (161 insertions / 4 deletions), i.e. the complete manifest of the branch is on staging.
3. **The canonicalisers have not moved since the fix.** `git diff --stat 13c9c43
   origin/staging -- <the three source files>` equals exactly the fix's own stat (6/7/8
   lines) — no later commit (PRs #196–#216) altered these files.
4. **All three sites carry `Object.create(null)` on staging tip:** `src/util/canonical.ts:30`,
   `src/util/canonical-json.ts:34`, `src/facts/hash.ts:24`.
5. **The regression suite exists and is green on staging tip:**
   `npx vitest run tests/proto-canonicaliser-hardening.test.ts` → **14/14 passed**
   (fresh worktree from `origin/staging` @ `dd21d62`, `npm ci`).

## Disposition

- Remote branch `claude/proto-canonicalizer-hardening` deleted as routine post-merge
  cleanup (restorable at any time via the "Restore branch" control on merged PR #194;
  the commit also survives at `refs/pull/194/head` and in the local worktree
  `.claude/worktrees/proto-hardening`).
- ROADMAP 1.25 wave item for the PLoT proto-canonicaliser: mark this sub-item DONE
  (delivered 2026-07-06 by PR #194); this lane adds the audit trail only.

## Residuals (out of the branch's scope — same hazard class, different subsystems)

A sweep of `src/` for sorted-key canonicaliser accumulators on staging tip found five
further sites. Two are non-hazards (key-reads only, no accumulator):
`src/util/downstream-tracker.ts` (hashes raw text; keys only feed `key_manifest`) and
`src/causal/identifiability.ts` (picks first sorted key). Three assign parse-derived keys
into plain `{}` objects and were **not** covered by PR #194:

| Site | Accumulator | Feeds | Exposure sketch |
|------|-------------|-------|-----------------|
| `src/sampling/graph-hash.ts:127` | `sortedParams = {}` over `edge.function_params` | determinism `graph_hash` → trace cache | a `__proto__` key in `function_params` is swallowed → two graphs share one hash |
| `src/normalisation/canonicalise.ts:257` | `sortedInterventions = {}` over `option.interventions` | canonical request (v2 run) | a `__proto__` intervention key is swallowed → two options canonicalise identically |
| `src/causal/seam.ts:38,44` | `f[v]` / `U[v]` over `dag.nodes` ids | SCM construction (compute path, not hash) | a node id `"__proto__"` mutates the accumulator's prototype |

Severity is plausibly lower (intervention/param keys are typically validated against graph
node ids upstream, and none of these gates response replay the way the idempotency path
does), but they are unverified. Tracked as follow-up work, not landed here — this lane's
mandate was land-or-supersede the existing branch, and the branch is superseded.

## Gates

- Doc-only change; Tier-1 typecheck + the authoritative pre-push hook
  (`scripts/pre-push-validate.sh`: typecheck + full suite) ran on push of this doc.
- Standing reds acknowledged: `audit`, `gates (windows-latest)` (pre-existing on every PR).
