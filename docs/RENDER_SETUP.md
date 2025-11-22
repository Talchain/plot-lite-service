# Render Setup Guide

**Auto-deploy from GitHub using Render Blueprint**

---

## Overview

This repo uses Render's Blueprint feature (`render.yaml`) to provision two services:

1. **plot-lite-service-staging** - Auto-deploys on every merge to `main`
2. **plot-lite-service** (production) - Manual deploy only (safer)

---

## One-Time Setup (You Do This Once)

### 1. Connect Repo to Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **Blueprint**
3. Select **Connect a repository**
4. Choose `plot-lite-service` repo
5. Authorize GitHub access if prompted

### 2. Create Services from Blueprint

1. Render will detect `render.yaml` automatically
2. Review the services:
   - `plot-lite-service-staging` (auto-deploy: ON)
   - `plot-lite-service` (auto-deploy: OFF)
3. Choose your team and confirm region (Oregon)
4. Click **Apply**

Render will now provision both services.

### 3. Add Secrets (Required)

After services are created, add secrets in Render dashboard:

**For `plot-lite-service-staging`**:
1. Go to service → **Environment**
2. Add secret:
   - Key: `AUTH_TOKEN`
   - Value: `<your-staging-auth-token>`
3. Click **Save Changes**

**For `plot-lite-service` (production)**:
1. Go to service → **Environment**
2. Add secret:
   - Key: `AUTH_TOKEN`
   - Value: `<your-production-auth-token>`
3. Click **Save Changes**

### 4. Set GitHub Secrets (Optional, for Smoke Test)

For the manual smoke test workflow:

1. Go to GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add secrets:
   - `PLOT_STAGING_URL`: `https://plot-lite-service-staging.onrender.com`
   - `PLOT_AUTH_TOKEN`: `<your-staging-auth-token>`

---

## Every Deploy (Automatic)

### Staging Auto-Deploy

1. Merge PR to `main`
2. Render automatically:
   - Pulls latest code
   - Runs `npm ci && npm run build`
   - Deploys to staging
   - Runs health check at `/v1/health`
3. Check deploy status in Render dashboard

**Typical deploy time**: 2-3 minutes

### Production Manual Deploy

1. Go to Render dashboard → `plot-lite-service` (production)
2. Click **Manual Deploy** → **Deploy latest commit**
3. Confirm deployment
4. Monitor health check

---

## Validation

### Manual Smoke Test (Local)

```bash
# Set staging URL and auth token
export PLOT_STAGING_URL=https://plot-lite-service-staging.onrender.com
export AUTH_TOKEN=<your-staging-token>

# Run smoke test
npm run smoke:staging
```

**Expected output**:
```
🔍 Smoke test against: https://plot-lite-service-staging.onrender.com

1️⃣  Health check...
   ✅ Health OK: { engine_p95_ms: 3.25, ... }

2️⃣  Determinism check (2 runs with same seed)...
   ✅ Determinism OK: <hash>

✅ Smoke test PASS
```

### GitHub Actions Smoke Test

1. Go to **Actions** tab in GitHub
2. Select **Staging Smoke Test** workflow
3. Click **Run workflow**
4. Monitor results

---

## Health Endpoint

**URL**: `https://plot-lite-service-staging.onrender.com/v1/health`

**Response**:
```json
{
  "status": "ok",
  "api_version": "v1",
  "engine_p95_ms": 3.25,
  "engine_p95_ms_rolling": 3.18,
  "json_429_count": 0,
  "sse_429_count": 0,
  "idem_cache_size": 0,
  "last_compute_ms": 2.5,
  "uptime_s": 1234
}
```

---

## Environment Variables

### Default Values (from `render.yaml`)

```bash
NODE_ENV=production
SCM_LITE_ENABLE=0          # Feature flag OFF by default
SCM_LITE_K=500
SCM_LITE_BELIEF_DEFAULT=0.5
AUTH_ENABLED=1
RATE_LIMIT_ENABLED=1
RATE_LIMIT_RPM=60
```

### Override in Render Dashboard

1. Go to service → **Environment**
2. Edit or add variables
3. Click **Save Changes**
4. Service will auto-redeploy with new values

---

## Enabling SCM-Lite (After Validation)

### Staging

1. Go to Render dashboard → `plot-lite-service-staging`
2. Environment → Edit `SCM_LITE_ENABLE`
3. Change value from `0` to `1`
4. Save (triggers redeploy)
5. Run smoke test to verify

### Production

1. Same steps as staging
2. Monitor for 24-48h before enabling

---

## Rollback

### Instant Rollback (Environment Variable)

1. Go to Render dashboard → service
2. Environment → Edit `SCM_LITE_ENABLE`
3. Change from `1` to `0`
4. Save (triggers redeploy in ~2 minutes)

### Full Rollback (Previous Commit)

1. Go to Render dashboard → service
2. Click **Manual Deploy**
3. Select previous commit from dropdown
4. Click **Deploy**

---

## Monitoring

### Render Dashboard

- **Logs**: Real-time logs for each service
- **Metrics**: CPU, memory, request count
- **Health Checks**: Auto-monitored at `/v1/health`

### Health Check Alerts

Render automatically monitors `/v1/health`:
- If health check fails 3 times in a row, service is marked unhealthy
- Render will attempt to restart the service

---

## Troubleshooting

### Deploy Failed

1. Check **Logs** in Render dashboard
2. Common issues:
   - Build failure: Check `npm ci && npm run build` locally
   - Missing dependencies: Verify `package.json`
   - Environment variable typo: Check spelling

### Health Check Failing

1. Check logs for errors
2. Verify `/v1/health` returns 200
3. Test locally: `npm run build && npm start`

### Smoke Test Failing

1. Check `PLOT_STAGING_URL` is correct
2. Verify `AUTH_TOKEN` is set
3. Check staging service is running in Render dashboard
4. Review logs for errors

---

## Cost Estimate

**Starter Plan** (per service):
- $7/month per service
- 512 MB RAM
- Shared CPU
- 400 build minutes/month

**Total**: ~$14/month for staging + production

---

## Support

- **Render Docs**: https://render.com/docs
- **Render Support**: support@render.com
- **Blueprint Docs**: https://render.com/docs/blueprint-spec

---

**Last Updated**: October 14, 2025
