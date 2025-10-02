# Deploying to Render

## Quick Setup

1. **Create Web Service** on [Render Dashboard](https://dashboard.render.com/)
   - Repository: `Talchain/plot-lite-service`
   - Branch: `main`
   - Runtime: `Node` (20+)
   - Build Command: `npm ci && npm run build`
   - Start Command: `npm start`
   - Auto-Deploy: ✅ Enabled

2. **Environment Variables**
   
   **Production (recommended)**:
   ```
   NODE_ENV=production
   PORT=10000
   CORS_ORIGINS=https://olumi.netlify.app,https://olumi.netlify.app/#/sandbox
   ```
   
   **Staging/Demo (with test routes)**:
   ```
   NODE_ENV=production
   PORT=10000
   CORS_ORIGINS=https://olumi.netlify.app,https://olumi.netlify.app/#/sandbox
   TEST_ROUTES=1
   ```
   
   **CORS Options**:
   - `CORS_ORIGINS`: Comma-separated list for multiple origins (recommended)
     Example: `CORS_ORIGINS=https://app.example.com,https://staging.example.com`
   - If not set, CORS is disabled (secure default)
   
   **Feature Flags**:
   - `TEST_ROUTES=1`: Enables demo endpoints like `/demo/stream` (can be toggled off later)
   - `RATE_LIMIT_ENABLED=0`: Disables rate limiting (not recommended for production)

3. **Optional: CI Deploy Hook**
   - In Render: Settings → Deploy Hook → Copy URL
   - In GitHub: Settings → Secrets → Add `RENDER_DEPLOY_HOOK_URL`

## Start Command
```bash
npm start
```
This runs `node dist/main.js` which:
- Reads `PORT` from `process.env.PORT` (Render sets this)
- Listens on `0.0.0.0` (required for Render)
- Enables CORS for `CORS_ORIGIN` if set

## Health Check
```
GET /health
```

## Local Verification (Node 20)

Before deploying, verify locally:

```bash
# Build
npm run build

# Start with test routes enabled
CORS_ORIGINS="http://localhost:5174" TEST_ROUTES=1 PORT=4311 npm start
```

In another terminal:

```bash
# Verify test routes are enabled
curl -s http://127.0.0.1:4311/health | jq .test_routes_enabled
# Expected: true

# Test demo SSE endpoint
curl -Ns http://127.0.0.1:4311/demo/stream?scenario=sch1 | sed -n '1,20p'
# Expected output:
# event: hello
# data: {"scenario":"sch1","seed":1}
#
# event: token
# data: {"text":"This"}
# ...
# event: done
# data: {}
```

## Notes
- Server auto-deploys on push to `main`
- Graceful shutdown on SIGTERM (zero-downtime)
- CORS disabled by default; set `CORS_ORIGINS` to enable
- Demo endpoints only available when `TEST_ROUTES=1`
