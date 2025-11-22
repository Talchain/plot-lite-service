#!/usr/bin/env zsh
set -eu
setopt interactivecomments

BASE='https://plot-lite-service.onrender.com'

echo 'HEALTH:'
curl -s "$BASE/health" | jq . | sed -e 's/^/  /'

echo 'HEAD /v1/run (expect HTTP/2 204):'
curl -I "$BASE/v1/run" | head -n1

echo 'LIMITS (expect schema+max_nodes+max_edges+max_body_kb+rate_limit_rpm+flags.scm_lite):'
curl -s "$BASE/v1/limits" | jq . | sed -e 's/^/  /'

echo 'REQUEST-ID echo (should return the same X-Request-Id):'
curl -i "$BASE/v1/run" \
  -H 'X-Request-Id: test-req-123' \
  -H 'Content-Type: application/json' \
  --data-binary '{"graph":{"nodes":[{"id":"A","label":"Option A"}],"edges":[]},"seed":4242}' \
  | grep -i '^x-request-id' || true

echo 'CORS preflight (Origin: https://olumi.netlify.app):'
curl -i -X OPTIONS "$BASE/v1/run" \
  -H 'Origin: https://olumi.netlify.app' \
  -H 'Access-Control-Request-Method: POST' \
  | grep -iE '^HTTP/|^access-control-allow-origin:|^access-control-allow-methods:|^access-control-allow-headers:|^access-control-expose-headers:' || true

echo 'OVERSIZE 413 (send ~100 KiB payload; expect 413):'
BODY="$(python3 - << 'PY'
import json
big = "x"*100*1024
print(json.dumps({"graph":{"nodes":[{"id":"A","label":"Option A"}],"edges":[]},"seed":4242,"pad":big}))
PY
)"
curl -i "$BASE/v1/run" -H 'Content-Type: application/json' --data-binary "$BODY" | head -n 20
