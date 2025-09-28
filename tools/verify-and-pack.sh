#!/usr/bin/env bash
set -euo pipefail
ENGINE="http://127.0.0.1:4311"
TEMPLATE="pricing_change"; SEED=101; FIXED_SEED=4242
NOW=$(date +"%Y%m%d-%H%M"); OUT="artifact/Evidence-Pack-$NOW"
mkdir -p "$OUT/engine" "$OUT/ui" "$OUT/reports"

echo "==> Optional self-start (PACK_SELF_START=1)"
SVR_PID=""
if [ "${PACK_SELF_START:-0}" = "1" ]; then
  echo "Starting temporary engine on 4311 (test routes ON; rate limit OFF)"
  (TEST_PORT=4311 TEST_ROUTES=1 RATE_LIMIT_ENABLED=0 node tools/test-server.js >"$OUT/engine/selfstart.log" 2>&1 & echo $! >"$OUT/engine/selfstart.pid") || true
  SVR_PID=$(cat "$OUT/engine/selfstart.pid" 2>/dev/null || true)
  # Wait for readiness
  for i in {1..50}; do
    if curl -sf "$ENGINE/health" >/dev/null; then echo "self-start ready"; break; fi; sleep 0.2;
  done
fi

echo "==> Setup (build + unit)"; npm ci; npm run build || true; npm test

echo "==> Contracts lane"; npm run test:contracts || true
echo "==> Stream lane"; npm run test:stream || true
echo "==> Security lane"; npm run test:security || true
echo "==> Perf lane"; npm run test:perf || true

echo "==> STRICT loadcheck"; STRICT_LOADCHECK=1 node tools/loadcheck-wrap.cjs || true
[ -f reports/warp/loadcheck.json ] && cp reports/warp/loadcheck.json "$OUT/reports/loadcheck.json"

echo "==> Determinism + ETag/304"
RATE_LIMIT_ENABLED=0 curl -i "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/draft-flows-200.h" -o "$OUT/engine/draft-flows-200.json"
ET=$(awk 'tolower($1)=="etag:"{print $2}' "$OUT/engine/draft-flows-200.h" | tr -d '\r')
RATE_LIMIT_ENABLED=0 curl -i -H "If-None-Match: ${ET}" "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/draft-flows-304.h" -o "$OUT/engine/draft-flows-304.txt"

echo "==> HEAD parity + 304"
RATE_LIMIT_ENABLED=0 curl -I "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/head-200.h" >/dev/null
RATE_LIMIT_ENABLED=0 curl -I -H "If-None-Match: ${ET}" "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/head-304.h" >/dev/null

echo "==> Health + Version"
RATE_LIMIT_ENABLED=0 curl -s "$ENGINE/health" | jq . > "$OUT/engine/health.json" || true
RATE_LIMIT_ENABLED=0 curl -s "$ENGINE/version" | jq . > "$OUT/engine/version.json" || true

echo "==> Taxonomy spot-checks"
RATE_LIMIT_ENABLED=0 curl -s -i "$ENGINE/draft-flows?template=__nope__&seed=${SEED}" > "$OUT/engine/invalid-template-404.txt" || true
RATE_LIMIT_ENABLED=0 curl -s -i "$ENGINE/draft-flows?template=${TEMPLATE}&seed=nan" > "$OUT/engine/bad-query-400.txt" || true
RATE_LIMIT_ENABLED=0 curl -s -i "$ENGINE/draft-flows?template=${TEMPLATE}&seed=999999" > "$OUT/engine/invalid-seed-404.txt" || true

echo "==> Access-log hygiene trigger (inspect logs separately)"
RATE_LIMIT_ENABLED=0 curl -s -i "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}&Authorization=sekret" >/dev/null || true

echo "==> Report v1 stamp check"
{ echo "schema:"; jq -r '.schema' "$OUT/engine/draft-flows-200.json"; \
  echo "meta.seed:"; jq -r '.meta.seed' "$OUT/engine/draft-flows-200.json"; } > "$OUT/engine/report-v1-stamp.txt" || true

echo "==> Fixture checksums"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "fixtures/pricing_change/${FIXED_SEED}.json" > "$OUT/engine/fixture-seed-${FIXED_SEED}.sha256" || true
  shasum -a 256 "fixtures/golden-seed-4242/stream.ndjson" > "$OUT/engine/stream-ndjson.sha256" || true
fi

echo "==> Access log snippet (if available)"
if [ -f "$OUT/engine/selfstart.log" ]; then
  tail -n 300 "$OUT/engine/selfstart.log" > "$OUT/engine/access-log-snippet.txt" || true
elif [ -n "${ENGINE_LOG_PATH:-}" ] && [ -f "$ENGINE_LOG_PATH" ]; then
  tail -n 300 "$ENGINE_LOG_PATH" > "$OUT/engine/access-log-snippet.txt" || true
else
  echo "no captured server log; run engine with stdout redirected to a file and set ENGINE_LOG_PATH to include a snippet" > "$OUT/engine/access-log-snippet.txt"
fi

echo "==> Summary README"
{
  echo "PLoT-lite Engine Evidence Pack";
  echo "time: $(date -u "+%Y-%m-%dT%H:%M:%SZ")";
  echo "engine: ${ENGINE}";
  echo "lanes: contracts, stream, security, perf (see reports/loadcheck.json)";
  P95=$(jq -r '.p95_ms // empty' "$OUT/reports/loadcheck.json" 2>/dev/null || echo "");
  if [ -n "$P95" ] && [ "$P95" != "null" ]; then echo "p95_ms: $P95"; fi
  echo "notes: UI not required; engine-only pack";
} > "$OUT/README.txt"

if [ -n "$SVR_PID" ]; then
  echo "==> Stopping self-started server ($SVR_PID)";
  kill "$SVR_PID" >/dev/null 2>&1 || true
fi

echo "Evidence Pack ready: $OUT"
echo "Place any UI artefacts under $OUT/ui and Playwright report under $OUT/reports if applicable"
