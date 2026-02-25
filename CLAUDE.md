# Claude Code Project Memory

## CRITICAL: Deployment Branch Mapping

| Environment | Branch | URL | Auto-Deploy |
|-------------|--------|-----|-------------|
| **STAGING** | `staging` | `https://plot-lite-service-staging.onrender.com` | ON COMMIT |
| **PRODUCTION** | `main` | `https://plot-lite-service.onrender.com` | ON COMMIT |

**THE RULE:** Push to `staging` → deploys to STAGING. Push to `main` → deploys to PRODUCTION. Never push to `main` without explicit user confirmation. Default target is always `staging`.

> **Historical context (2026-01-23):** Two incidents where `main` was pushed instead of `staging`, and `./monitor-deployment.sh` was used (it checks production). These rules exist to prevent recurrence.

### Safety rules:
- **NEVER** run `./monitor-deployment.sh` — it checks PRODUCTION
- **NEVER** assume deployment targets without verifying the branch
- **NEVER** trust render.yaml — verify actual Render dashboard config
- **ALWAYS** verify both environment builds BEFORE and AFTER any push
- **ALWAYS** ask user to confirm if unsure about deployment target

### To Deploy to STAGING:
```bash
git checkout staging
git merge main  # or: git cherry-pick <commit>
git push origin staging
curl -s https://plot-lite-service-staging.onrender.com/health | jq '{build, status}'
```

### To Deploy to PRODUCTION:
```bash
# STOP - Confirm with user first!
git push origin main
curl -s https://plot-lite-service.onrender.com/health | jq '{build, status}'
```

---

## Stale .js files

Compiled `.js` files in `src/` alongside `.ts` sources cause silent shadowing bugs — Node resolves the `.js` file instead of the `.ts` source.

**Detection:**
```bash
find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;
```

If found, flag them. When debugging unexpected behaviour, check for stale `.js` files as a first step.

---

## Pre-Push Validation

Every `git push` runs `scripts/pre-push-validate.sh` automatically via the Husky pre-push hook. Also run it explicitly before pushing: `bash scripts/pre-push-validate.sh`

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

### Bypass (emergency only):
```bash
git push --no-verify origin staging
```

### Claude Code integration:
A `PreToolUse` hook in `.claude/settings.json` intercepts `git push` Bash commands and runs the same validation. Exit code 2 blocks the push; exit code 0 allows it.

---

## Git Workflow

- Before committing, run `git status` and `git diff --staged` to verify only intended changes are staged. Never commit all uncommitted changes without explicit user approval.
- Never bundle unrelated uncommitted changes into a deployment commit.
- If there are uncommitted changes from previous sessions, flag them and get user approval before including.
- No simultaneous Claude Code sessions on this repository. If you detect unexpected uncommitted changes or stash entries at session start, flag them before proceeding.
- After making commits, always execute `git push` and verify it succeeded. Do not just summarise commands — run them.

---

## Testing Commands

```bash
npm test                                    # All tests
npm test -- --run tests/FILE.test.ts       # Specific file
npm test -- --grep "pattern"               # Pattern match
```

After any code changes, run the full test suite and typecheck (`npx tsc --noEmit`) before committing. Report the exact number of passing/failing tests.

---

## Session Preamble

At the start of every session, before any other work:

```bash
# 1. Branch and recent history
git branch --show-current && git log --oneline -5 && git status

# 2. Check for stale .js files (see "Stale .js files" section)
find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;

# 3. Check for uncommitted changes or stash entries
git stash list
```

Report the output. Confirm the branch is correct for the task before starting any work.

---

## Task completion checklist

Before reporting ANY task as complete, run and show the output of all five checks:

```bash
# 1. Correct branch?
git branch --show-current

# 2. Clean state? (no accidental uncommitted changes)
git status

# 3. Recent commits match the work just done?
git log --oneline -5

# 4. All tests pass?
npm test

# 5. TypeScript compiles cleanly?
npx tsc --noEmit
```

If any check fails, fix it before reporting completion. Do not report "done" with failing tests or uncommitted changes unless explicitly discussed with the user.

---

## Debugging

- When investigating bugs or tracing data flow, check ALL layers of the pipeline: PLoT → ISL translation (`from` → `from_`), V2 and V3 adapters, direct error shapes AND PLoT-wrapped error shapes. Do not stop at the first code path found.
- Check for stale `.js` files (see "Stale .js files" section) when debugging unexpected behaviour.

### Data flow tracing (mandatory before any fix)

Before implementing any bug fix or feature that touches data flowing between services, trace and document the complete path:

1. Where does the data originate? (CEE LLM response? ISL computation? PLoT assembly?)
2. List every transform/adapter layer it passes through (with file paths)
3. Where is it consumed in the final response?
4. Are there alternate code paths or error shapes? (e.g., direct error vs PLoT-wrapped error, V2 vs V3 adapter)

Only after the trace is documented, implement fixes at ALL affected layers. Do not fix one layer and assume others are correct.

Common multi-layer patterns in this codebase:
- CEE response → PLoT adapter → ISL request (field name translations like `from` → `from_`)
- ISL response → PLoT V2/V3 adapter → UI store (two adapter shapes)
- Error responses: direct shape AND PLoT-wrapped shape must both be handled
- CEE → store → PLoT chain: check extraction, normalisation, and passthrough at every boundary

---

## API / Schema Changes

- The OpenAPI spec is hand-authored (no generation script). When modifying API schemas or renaming fields, update the spec manually before pushing. Commit the updated spec.

---

## Code review analysis

When asked to address code review feedback:

1. Read ALL feedback items first before making any changes
2. For each item, determine independently:
   - Is the feedback valid and does it require a code change?
   - Is it already handled by existing code?
   - Is it incorrect or based on a misunderstanding of the architecture?
3. State your reasoning for each determination before making changes
4. Do not make changes just to appease reviewers if the existing code is correct
5. Group changes by affected file to minimise unnecessary edits

---

## Proactive codebase audit

Run this audit before major deployments or when requested. Check for:

1. **Stale .js files:** See "Stale .js files" section
2. **Hardcoded timeouts:** Grep for magic numbers (setTimeout, ms values) that should reference centralised config
3. **Error shape gaps:** In catch blocks and error handlers, verify both direct AND wrapped error formats are handled
4. **Schema drift:** Diff the hand-authored OpenAPI spec against actual endpoint behaviour
5. **Nullable field mismatches:** Check Zod schemas against actual API response shapes for optional/nullable alignment
6. **Uncommitted files:** `git status` — flag anything that could accidentally be bundled into the next commit

Categorise findings as critical/warning/info with production impact assessment.
