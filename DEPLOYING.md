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
   ```
   NODE_ENV=production
   PORT=10000
   CORS_ORIGIN=https://your-ui-domain.netlify.app
   ```

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

## Notes
- Server auto-deploys on push to `main`
- Graceful shutdown on SIGTERM (zero-downtime)
- CORS disabled by default; set `CORS_ORIGIN` to enable
