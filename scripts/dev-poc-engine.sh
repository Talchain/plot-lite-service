#!/usr/bin/env bash
set -euo pipefail

echo "==> PLoT Engine PoC Bring-Up"

# Prefer Node 20 via nvm if available (but don't fail if not)
if command -v nvm &> /dev/null; then
  echo "==> Using Node 20 via nvm"
  nvm use 20 2>/dev/null || true
fi

# Install and build
echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Building"
npm run build

# Create .poc directory
mkdir -p .poc

# Export PoC environment
export PORT=4311
export TEST_ROUTES=1
export CORS_ORIGINS="http://localhost:5174,http://127.0.0.1:5174,http://localhost:5180,http://127.0.0.1:5180"

echo "==> Starting Engine on port $PORT"
echo "    CORS_ORIGINS: $CORS_ORIGINS"
echo "    TEST_ROUTES: $TEST_ROUTES"

# Start server in background
npm start > .poc/engine.log 2>&1 &
echo $! > .poc/engine.pid
SERVER_PID=$(cat .poc/engine.pid)
echo "    PID: $SERVER_PID"

# Poll health endpoint up to 40s
echo "==> Waiting for engine to be ready..."
TIMEOUT=40
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -s http://127.0.0.1:4311/health > /dev/null 2>&1; then
    echo "==> Engine is ready!"
    HEALTH=$(curl -s http://127.0.0.1:4311/health)
    echo ""
    echo "ENGINE_OK: port=4311, cors=OK, test_routes=ON"
    echo "ENGINE_HEALTH: $HEALTH"
    exit 0
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  echo -n "."
done

# Timeout - print failure
echo ""
echo "ENGINE_FAIL: timeout"
echo "==> Last 80 lines of .poc/engine.log:"
tail -n 80 .poc/engine.log
exit 1
