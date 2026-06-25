# PLoT — plot-lite-service

Assembly/adapter layer between UI/CEE and ISL: builds analysis requests, adapts ISL
responses (V2/V3), and enriches results back to CEE. Node / TS, npm.
Platform map + cross-cutting hazards: repo-parent `CLAUDE.md`. Global git/verify
practice: `~/.claude/CLAUDE.md`.

## CRITICAL: deployment branch mapping

| Environment | Branch | URL | Auto-deploy |
|-------------|--------|-----|-------------|
| **STAGING** | `staging` | `https://plot-lite-service-staging.onrender.com` | on commit |
| **PRODUCTION** | `main` | `https://plot-lite-service.onrender.com` | on commit |

Push to `staging` → STAGING. Push to `main` → PRODUCTION. **Default target is always `staging`; never push `main` without explicit confirmation.**

- **NEVER run `./monitor-deployment.sh`** — it checks PRODUCTION.
- **NEVER trust `render.yaml`** — verify actual Render dashboard config.
- Verify the target health endpoint before *and* after any push: `curl -s <url>/health | jq '{build, status}'`.

> Historical context (2026-01-23): two incidents where `main` was pushed instead of `staging` and `monitor-deployment.sh` (production) was used. These rules exist to prevent recurrence.

## Service specifics

- **The enrichment payload PLoT returns to CEE is an untyped passthrough (`z.record`)** —
  shape is not validated. It is a known-open seam: when you touch enrichment, don't
  assume the contract catches a wrong or missing field. Typing it is the platform's
  highest-leverage hardening.
- **Edge field `from` → `from_`: PLoT forwards `from` unchanged.** ISL's inbound Pydantic
  model performs the alias (ISL `src/models/robustness_v2.py`: `from_: str = Field(alias="from")`,
  `populate_by_name=True`). Don't add a rename here — the translation belongs in ISL.
- The **OpenAPI spec is hand-authored** (no generator). When you change a schema or rename
  a field, update the spec manually and commit it.
- Stale `.js` co-located with `.ts` in `src/` shadows the source — check first when debugging:
  `find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;`

## Known pre-existing CI reds (don't chase them)

The `audit` job (fast-uri / fastify advisories) and `gates (windows-latest)` (invalid path
`tools/sdk-smoke:python.mjs`) fail on **every** PR, unrelated to your change. Verify they're
still failing for these same reasons before spending time — don't treat them as regressions.

## Commands & gates

```bash
npx tsc --noEmit                         # type check
npx vitest run --changed --bail=1        # changed-file tests
npm test                                 # full (build + vitest + fixtures + OpenAPI + loadcheck) — Tier 3
bash scripts/pre-push-validate.sh        # the full gate (also runs automatically on push)
```

- **Tier 1 (after every change):** `npx tsc --noEmit` + `npx vitest run --changed --bail=1`. No related tests → typecheck alone.
- **Tier 3 (push to staging only):** the Husky pre-push hook runs `scripts/pre-push-validate.sh` automatically (branch guard, typecheck, full test suite, stale-`.js`, dep audit). A `PreToolUse` hook in `.claude/settings.json` runs the same validation on `git push` Bash commands (exit 2 blocks). Don't run the full suite after every change.

## Working rules (shared doctrine, condensed)

- **Data-flow tracing before any cross-boundary fix:** origin (CEE LLM / ISL compute / PLoT assembly) → every adapter (with paths) → consumer → alternate shapes (direct error vs PLoT-wrapped error, V2 vs V3 adapter). Fix *all* affected layers, not the first found.
- **Code-review feedback:** read every item first, judge each independently (valid / already-handled / misunderstanding), state reasoning, don't change correct code to appease.
