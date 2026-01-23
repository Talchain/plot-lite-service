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
```
