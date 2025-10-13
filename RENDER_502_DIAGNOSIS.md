# 🔍 Render 502 Diagnosis

## Current Status
- ✅ Service built successfully
- ✅ Server started on port 10000
- ❌ Render routing shows "no-deploy" (502 Bad Gateway)

## Logs Analysis
```
Server listening at http://127.0.0.1:10000
Server listening at http://10.201.124.247:10000
server started
route":"/","statusCode":404  ← Render health check hitting root
```

## Root Cause
Render's default health check is hitting `/` (root) and getting 404, which fails the health check.

## Solution Options

### Option 1: Add Root Route (Quick Fix)
Add a simple root route that returns 200:

```typescript
// In src/createServer.ts, add after other routes:
app.get('/', async () => {
  return { status: 'ok', service: 'plot-lite-engine' };
});
```

### Option 2: Configure Render Health Check Path
In Render dashboard:
1. Go to plot-lite-service settings
2. Find "Health Check Path"
3. Set to: `/v1/health`
4. Save and redeploy

### Option 3: Add Both Root and Health Routes
Ensure both `/` and `/v1/health` return 200 OK.

## Immediate Action

**Check Render Dashboard:**
https://dashboard.render.com

Look for:
- Health check configuration
- Recent deploy logs
- Service status

**If health check is set to `/`:**
We need to add a root route handler.

**If no health check is configured:**
Render defaults to checking `/` - we still need to handle it.

## Quick Fix Implementation

```bash
# Add root route to createServer.ts
# After line ~310 (after /api route)
```

```typescript
// Root route for Render health check
app.get('/', async () => {
  return { 
    status: 'ok', 
    service: 'plot-lite-engine',
    version: process.env.BUILD_ID || 'dev'
  };
});
```

Then:
```bash
git add src/createServer.ts
git commit -m "fix: add root route for render health check"
git push origin main
```

## Verification

Once deployed:
```bash
curl https://plot-lite-service.onrender.com/
# Should return: {"status":"ok","service":"plot-lite-engine"}

curl https://plot-lite-service.onrender.com/v1/health
# Should return: {"status":"ok",...}
```

