#!/bin/bash
set -e

BASE="https://plot-lite-service.onrender.com"

echo "=== Health Check ==="
curl -fsS "$BASE/v1/health" | jq -c '{status: .status, version: .version}'

echo -e "\n=== Limits Check ==="
curl -fsS "$BASE/v1/limits" | jq

echo -e "\n=== Validate Check ==="
cat > /tmp/run.json <<'JSON'
{"graph":{"nodes":[{"id":"A","label":"A"},{"id":"B","label":"B"}],"edges":[{"from":"A","to":"B","weight":0.7}]},"seed":4242}
JSON
curl -fsS -H 'Content-Type: application/json' -d @/tmp/run.json "$BASE/v1/validate" | jq

echo -e "\n=== Run & Determinism Check ==="
H1=$(curl -fsS -H 'Content-Type: application/json' -d @/tmp/run.json "$BASE/v1/run" | tee /tmp/resp1.json | jq -r '.result.response_hash')
echo "Hash 1: $H1"

H2=$(curl -fsS -H 'Content-Type: application/json' -d @/tmp/run.json "$BASE/v1/run" | tee /tmp/resp2.json | jq -r '.result.response_hash')
echo "Hash 2: $H2"

if [ "$H1" = "$H2" ]; then
  echo "✅ Determinism OK - Hashes match"
else
  echo "❌ Hash mismatch!"
  exit 1
fi

echo -e "\n=== Verify response_hash exists ==="
jq '{response_hash: .result.response_hash, summary: .result.summary}' /tmp/resp1.json

echo -e "\n✅ All smoke tests passed!"
