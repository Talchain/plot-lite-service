# Claude Code Project Memory

## CRITICAL: Deployment Branch Mapping

| Environment | Branch | URL | Auto-Deploy |
|-------------|--------|-----|-------------|
| **STAGING** | `staging` | `https://plot-lite-service-staging.onrender.com` | ON COMMIT |
| **PRODUCTION** | `main` | `https://plot-lite-service.onrender.com` | ON COMMIT |

### THE RULE:
- **Push to `staging` branch → deploys to STAGING**
- **Push to `main` branch → deploys to PRODUCTION**

---

## CRITICAL: Deployment Safety Rules

### NEVER DO THIS:
- **NEVER** push to `main` when asked to deploy to staging
- **NEVER** run `./monitor-deployment.sh` - it checks PRODUCTION
- **NEVER** assume deployment targets without verifying the branch
- **NEVER** trust render.yaml - verify actual Render dashboard config

### ALWAYS DO THIS:
- **ALWAYS** confirm which BRANCH to push to before any deployment
- **ALWAYS** verify: staging deployment = push to `staging` branch
- **ALWAYS** verify both environment builds BEFORE and AFTER any push
- **ALWAYS** ask user to confirm if unsure about deployment target

---

## Deployment Process

### To Deploy to STAGING:
```bash
# Step 1: Checkout staging branch
git checkout staging

# Step 2: Merge changes from main (or cherry-pick specific commits)
git merge main  # or: git cherry-pick <commit>

# Step 3: Push to staging branch
git push origin staging

# Step 4: Monitor STAGING (note: -staging in URL)
curl -s https://plot-lite-service-staging.onrender.com/health | jq '{build, status}'
```

### To Deploy to PRODUCTION:
```bash
# STOP - Confirm with user first!
# "You want to deploy to PRODUCTION (main branch). Please confirm."

# Only after explicit confirmation:
git push origin main

# Monitor PRODUCTION
curl -s https://plot-lite-service.onrender.com/health | jq '{build, status}'
```

---

## Pre-Deployment Checklist

Before ANY deployment:
- [ ] What environment? (staging or production)
- [ ] What branch? (staging → staging, production → main)
- [ ] Check current builds on BOTH environments
- [ ] Confirm with user if deploying to production

---

## Pre-Push Validation

Every `git push` runs `scripts/pre-push-validate.sh` automatically via the Husky pre-push hook.

### Checks performed:
| # | Check | What it catches |
|---|-------|-----------------|
| 1 | Branch guard | Direct push to `main` (blocks accidental production deploy) |
| 2 | TypeScript | `npx tsc --noEmit` compilation errors |
| 3 | Test suite | `npm test` (build + vitest + fixtures + OpenAPI + loadcheck) |
| 4 | Stale .js | Compiled .js files accidentally tracked by git in src/ |
| 5 | Dep audit | `file:` refs in package.json / package-lock.json |
| 6 | OpenAPI | SKIPPED (no generation script; spec is hand-authored) |
| 7 | Summary | Branch, files changed, pass/fail verdict |

### Run manually:
```bash
bash scripts/pre-push-validate.sh
```

### Bypass (emergency only):
```bash
git push --no-verify origin staging
```

### Claude Code integration:
A `PreToolUse` hook in `.claude/settings.json` intercepts `git push` Bash commands and runs the same validation. Exit code 2 blocks the push; exit code 0 allows it.

---

## Incident Log

### 2026-01-23: Pushed to main instead of staging (TWICE)
- **What happened:** When asked to deploy to staging, pushed to `main` branch
- **Impact:** Accidentally deployed to PRODUCTION instead of STAGING
- **Root cause:** Assumed `main` deploys to staging based on outdated render.yaml
- **Actual config:** `main` → production, `staging` → staging
- **Prevention:** Always verify branch-to-environment mapping. staging branch = staging env.

### 2026-01-23: Used wrong monitoring script
- **What happened:** Ran `./monitor-deployment.sh` which checks production URL
- **Impact:** Falsely reported staging deployment complete
- **Prevention:** Never use that script. Always use explicit curl with verified URL.

---

## Testing Commands

```bash
npm test                                    # All tests
npm test -- --run tests/FILE.test.ts       # Specific file
npm test -- --grep "pattern"               # Pattern match
bash scripts/pre-push-validate.sh           # Pre-push validation (7 checks)
```

---

## Deployment

- Always push to `staging` unless explicitly told otherwise. Never push to `main` without explicit user confirmation.
- After making commits, always execute `git push` and verify it succeeded. Do not just summarise commands — run them.
- Run `bash scripts/pre-push-validate.sh` before every push. This is also enforced by the git hook, but run it explicitly to catch issues early.

---

## Git Workflow

- Before committing, run `git status` and `git diff --staged` to verify only intended changes are staged. Never commit all uncommitted changes without explicit user approval.
- No simultaneous Claude Code sessions on this repository. If you detect unexpected uncommitted changes or stash entries at session start, flag them before proceeding.

---

## Session Preamble

At the start of every session, before any other work:
```bash
git branch --show-current && git log --oneline -3 && git status
```
Report the output. Confirm the branch is correct for the task before proceeding.

---

## Testing

- After any code changes, run the full test suite and typecheck (`npx tsc --noEmit`) before committing. Report the exact number of passing/failing tests.

---

## Debugging

- When investigating bugs or tracing data flow, check ALL layers of the pipeline: PLoT → ISL translation (`from` → `from_`), V2 and V3 adapters, direct error shapes AND PLoT-wrapped error shapes. Do not stop at the first code path found.
- Be aware of stale `.js` files co-located with `.ts` source files in `src/`. Node may resolve the `.js` instead of `.ts`. Check for and remove stale `.js` files when debugging unexpected behaviour.

---

## API / Schema Changes

- When modifying API schemas or renaming fields, regenerate the OpenAPI spec (if generation exists in this repo) before pushing. Commit the updated spec.

---

## Code Review

- When asked to critically analyse code review feedback, evaluate each point independently. Determine which items require code changes and which are already correct. Do not make changes just to appease reviewers if the existing code is right.
