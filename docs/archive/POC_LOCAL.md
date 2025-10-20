# Local PoC Setup for Engine

## One-Command Bring-Up

Run the Engine locally with PoC-friendly defaults:

```bash
npm run dev:poc
```

This will:
- Use Node 20 (via nvm if available)
- Kill any existing process on port 4311
- Install dependencies and build
- Start the Engine with:
  - **Port**: 4311
  - **CORS**: Open to localhost:5174, 127.0.0.1:5174, localhost:5173, 127.0.0.1:5173
  - **Test Routes**: Enabled (includes `/demo/stream`)

## Verification

In another terminal, run:

```bash
npm run accept:poc
```

### Expected Output

```
=== ENGINE ACCEPTANCE ===
ENGINE_OK: port=4311, cors=OK, test_routes=ON
ENGINE_HEALTH: {"status":"ok",...}
```

## Manual Verification

### Health Check
```bash
curl -s http://127.0.0.1:4311/health | jq .
```

### Demo SSE Endpoint
```bash
curl -Ns 'http://127.0.0.1:4311/demo/stream?scenario=sch1' | head -n 12
```

Expected: `event: hello`, multiple `event: token`, then `event: done`

## Environment Variables

The PoC script sets:
- `PORT=4311`
- `CORS_ORIGINS=http://localhost:5174,http://127.0.0.1:5174,http://localhost:5173,http://127.0.0.1:5173`
- `TEST_ROUTES=1`

To customize, export before running:
```bash
export PORT=8080
npm run dev:poc
```

## Stopping the Engine

Press `Ctrl+C` in the terminal running the engine, or:

```bash
lsof -ti:4311 | xargs kill
```
