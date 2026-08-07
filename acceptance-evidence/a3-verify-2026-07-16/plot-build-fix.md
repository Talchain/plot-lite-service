# PLoT staging "BUILD-FAILED" for #233 — root-cause diagnosis (A3)

> ## ✅ RESOLVED — status appended 2026-08-08 at merge (R1 PR-disposition pass)
>
> **The fault diagnosed below is dead. Read this file as archaeology, not as a live incident.**
> Derived 2026-08-08: `plot-lite-service-staging` `/health` reports `build: 1b36c34`, which is the
> current `staging` tip `1b36c34a` — i.e. the Render↔GitHub `git clone` grant works and deploys are
> landing (five commits deployed 6–7 Aug 2026). The "Corrective action (owner, in Render dashboard)"
> section below has been carried out; do not re-run it.
>
> **What survives the resolution and is still worth reading:**
> 1. **The corrected premise.** The task that spawned this work asserted a TypeScript/code defect.
>    That was false, and this file is the only place the correction is recorded.
> 2. **The systemic gap, which is NOT known to be fixed:** a persistent GitHub `403` silently
>    stranded staging deploys **with no alert**. Nothing was measured on 2026-08-08 to show that
>    deploy-failure alerting now exists. Treat that as open until someone derives otherwise.
> 3. **The method** — reading the Render build log before assuming a code cause.


**Date:** 2026-07-19
**Service:** `plot-lite-service-staging` (`srv-d4sl44s9c44c73ep4ak0`)
**Failed deploy:** `dep-d9e20i28qa3s73eesujg` — commit `ad255d3c` (#233), `build_failed`
**Base investigated:** `origin/staging` @ `ad255d3c` (fresh blobless-equivalent clone; tip confirmed via `git log`).

## TL;DR — verdict

**The Render "build failure" is NOT a code defect and NOT specific to #233.**
Render's build **failed at the `git clone` step with HTTP `403 Forbidden` from GitHub**,
before `npm ci` or `npm run build` ever ran. The `plot-lite-service` code at `ad255d3c`
compiles and builds cleanly under every condition tested. **No repository code change can
fix this.** The fix is operational: **restore Render's GitHub authorization** (reconnect /
re-authorize the Render GitHub App for the `Talchain` org in the Render dashboard), then
re-deploy `ad255d3c` (which is already green).

The original diagnostic hypothesis in the task (a type error in `tsc -p tsconfig.tools.json`,
a stale `.js` failing `check-no-stale-js.sh`, or an emit-only `tsc` error) is **disproven** —
see evidence below.

## The actual failure — Render build log (ground truth via Render API)

Deploy `dep-d9e20i28qa3s73eesujg`, created `00:54:32Z`, finished `00:55:28Z` (~56s):

```
00:54:35 ==> Downloading cache...
00:54:35 ==> Cloning from https://github.com/Talchain/plot-lite-service
00:54:36 fatal: unable to access 'https://github.com/Talchain/plot-lite-service.git/': The requested URL returned error: 403
00:54:36 ==> Retrying git clone...
00:54:42 fatal: unable to access '...': The requested URL returned error: 403
00:54:52 fatal: unable to access '...': The requested URL returned error: 403
00:55:13 fatal: unable to access '...': The requested URL returned error: 403
00:55:27 fatal: unable to access '...': The requested URL returned error: 403
00:55:27 ==> Unable to clone https://github.com/Talchain/plot-lite-service
```

The build log contains **no `npm ci`, no `tsc`, no build-step output** — the three build
steps never executed. The failure is entirely 5 failed `git clone` attempts (all HTTP 403),
then give-up.

### Persistent, not transient

I triggered a fresh redeploy of the same commit (`dep-d9e2hjjtqb8s739luevg`, `01:30`).
It **build_failed identically** — same `403` on `git clone`, 5 retries, "Unable to clone".
So this is a **persistent** Render→GitHub access failure, not a one-off blip.

### Org-wide, not plot-specific

`cee-staging` (`srv-d4slpaili9vc73eiq4og`) also has a `build_failed` deploy at `00:40` with
the **identical 403** cloning `olumi-assistants-service`:

```
00:40:23 ==> Cloning from https://github.com/Talchain/olumi-assistants-service
00:40:23 fatal: unable to access '.../olumi-assistants-service.git/': The requested URL returned error: 403
... (5 retries) ...
00:41:14 ==> Unable to clone https://github.com/Talchain/olumi-assistants-service
```

`isl-staging` is currently `live` only because its last deploy (`07-18T23:02`) predates the
outage window (~`00:40Z` onward on `07-19`); it has not attempted a deploy since.

**Conclusion:** GitHub is returning `403 Forbidden` to Render's clone requests **across the
Talchain org** — a revoked/expired Render GitHub App installation token or OAuth grant (or a
GitHub-side block on Render's requests). This is the Render↔GitHub integration, not the code.

## Proof the #233 code is fine (build hypothesis disproven)

| Check | Result |
|-------|--------|
| `npm run build` (all 3 steps: `tsc -p tsconfig.json` emit, `tsc -p tsconfig.tools.json`, `check-no-stale-js.sh --clean`) on macOS, fresh clone + `npm ci` | **PASS** (exit 0, all three) |
| Same build on a **case-sensitive APFS volume** (reproduces Linux/Render module-resolution) | **PASS** (all three, exit 0) — no case-sensitivity bug |
| `tsc -p tsconfig.json` (emit) under pinned **TypeScript 5.9.2** | PASS |
| `tsc -p tsconfig.json` (emit) under **TypeScript 7.0.2** (latest) | PASS |
| `tsc -p tsconfig.tools.json` `--listFiles` | closure contains **0 `src/` files** → step 2 cannot be affected by any #233 change (#233 only touched `src/`) |
| Committed `.js` in `src/` (would trip `check-no-stale-js.sh`) | **none** (`git ls-files 'src/**/*.js'` → 0) |
| GitHub Actions **`test`** check on #233 PR head `81c9a1b9` | **success** — and `ci.yml`'s `test` job runs the **full `npm run build`** (line 32) + `check-no-stale-js.sh` (line 17) + `npm test` on `ubuntu-latest` |

The `test` CI check running the complete `npm run build` on Ubuntu passed green on the merged
PR. The build the task suspected has therefore already been proven-green in CI, on Linux,
running exactly what Render runs.

## The task's "CI didn't run the build" premise is also inaccurate

The task stated: *"GitHub CI only ran `tsc -p tsconfig.json --noEmit` + the vitest suite — it
did NOT run `tsc -p tsconfig.tools.json` or `check-no-stale-js.sh`."*

Not so. `.github/workflows/ci.yml` triggers on **every `pull_request`** and runs:
- `check-no-stale-js.sh` (CI mode) — line 17
- `npm run build` (the full 3-step build, incl. `tsc -p tsconfig.tools.json`) — line 32
- `npm test` — line 34

`engine-ci.yml`, `release.yml`, `perf-gate.yml`, `perf-probe.yml` also run `npm run build`.
So **CI's build gate already matches what Render builds.** There is no build-step gate gap.

## Fix

**No code change.** The corrective action is operational and requires the repo owner:

1. **Restore Render's GitHub access.** In the Render dashboard: reconnect the GitHub account /
   re-authorize the Render GitHub App for the `Talchain` org (GitHub → Settings → Applications
   → Render, and/or Render → Account → GitHub → Reconnect). A `403` on clone is a rejected
   credential, not a missing repo.
2. **Re-deploy `ad255d3c`** for `plot-lite-service-staging` (and `cee-staging`). Because the
   commit is already CI-green and compiles cleanly, the clone is the only blocker — once GitHub
   access is restored the deploy will build and go live, making the #233 handshake live.

Because there is no code defect, there is **no mutation check** (nothing to revert), and a
`fix(build):` code PR would be non-load-bearing — reverting it would not re-break the Render
build, so it would be "guarantee theatre." This document is the deliverable instead.

## Systemic recommendation

The gate-vs-deploy gap the task hypothesized does not exist (CI already runs `npm run build`).
The real, still-open systemic weaknesses this incident exposed:

1. **A persistent GitHub `403` silently strands staging deploys with no alert.** Render retries
   the clone 5× and then gives up; the previous tip keeps serving, so the outage is invisible
   unless someone checks the Render dashboard. Add deploy-failure alerting (Render notifications
   / a scheduled `GET /v1/services/{id}/deploys?limit=1` status probe that pings when the latest
   staging deploy is `build_failed`) so a stranded deploy is caught in minutes, not by chance.
2. **The Render GitHub authorization is a shared single point of failure across all four
   services** — when it lapses, the whole org's auto-deploy stops. Track the Render↔GitHub grant
   as an owned dependency (who renews it, expiry/rotation) rather than discovering lapses via
   red deploys.
3. Optional repo hardening (unrelated to this incident, but tightens the local gate): the
   `.husky/pre-push` gate's Check 2 runs `npx tsc --noEmit` (the `tsconfig.json`-only, no-emit
   variant); its Check 3 (`npm test`) does run `npm run build` transitively, so the local gate
   does cover the full build — but only when NOT bypassed with `--no-verify`. #233's first push
   used `--no-verify`. That did not cause this failure (the build is green), but a policy of not
   bypassing the pre-push gate keeps the local and CI/Render build gates aligned.

## Reproduction commands (for the record)

```bash
# fresh clone at the failed tip
git clone --branch staging https://github.com/Talchain/plot-lite-service.git && cd plot-lite-service
git log --oneline -1        # ad255d3c ... (#233)
npm ci
npm run build               # PASS — all 3 steps clean

# Render ground truth (Render API; owner tea-d3eqr815pdvs73c6dn5g)
GET /v1/services/srv-d4sl44s9c44c73ep4ak0/deploys/dep-d9e20i28qa3s73eesujg   # status: build_failed
GET /v1/logs?resource=srv-d4sl44s9c44c73ep4ak0&startTime=...&endTime=...     # shows 403 clone loop
```
