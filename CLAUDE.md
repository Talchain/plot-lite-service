# Claude Code Project Memory

## CRITICAL: Deployment Safety Rules

### NEVER DO THIS:
- **NEVER** run `./monitor-deployment.sh` - it checks PRODUCTION
- **NEVER** assume a URL is staging without explicitly verifying the hostname
- **NEVER** report "deployment complete" without confirming the correct environment
- **NEVER** deploy to production without explicit user confirmation AND a separate explicit command

### ALWAYS DO THIS:
- **ALWAYS** include the full URL in any deployment verification command
- **ALWAYS** say the environment name out loud before running health checks
- **ALWAYS** verify the hostname contains "staging" for staging deployments

---

## Environment URLs (MEMORIZE THESE)

| Environment | URL | Contains |
|-------------|-----|----------|
| **STAGING** | `https://plot-lite-service-staging.onrender.com` | `-staging` in hostname |
| **PRODUCTION** | `https://plot-lite-service.onrender.com` | NO `-staging` |

**Visual check:** If the URL does NOT contain `-staging`, it is PRODUCTION.

---

## Deployment Verification Process

### For Staging Deployments:

```bash
# Step 1: Push to main
git push origin main

# Step 2: ONLY use this command - note "staging" in URL
curl -s https://plot-lite-service-staging.onrender.com/health | jq '{build, status}'

# Step 3: Verify build hash matches expected commit
git rev-parse --short HEAD  # Compare with build field above
```

### For Production Deployments:

1. **STOP** - Confirm with user: "You want me to deploy to PRODUCTION. This requires manual action in Render dashboard. Please confirm."
2. Only proceed with explicit confirmation
3. User must trigger deploy manually in Render
4. Then verify: `curl -s https://plot-lite-service.onrender.com/health | jq '{build, status}'`

---

## Incident Log

### 2026-01-23: Incorrect Production Health Check
- **What happened:** When asked to deploy to staging, ran `./monitor-deployment.sh` which checks production URL
- **Impact:** Falsely reported staging deployment complete based on production health
- **Root cause:** Used existing script without verifying target URL
- **Prevention:** Never use `./monitor-deployment.sh`. Always use explicit curl with full URL containing `-staging`

---

## Testing Commands

```bash
npm test                                    # All tests
npm test -- --run tests/FILE.test.ts       # Specific file
npm test -- --grep "pattern"               # Pattern match
```
