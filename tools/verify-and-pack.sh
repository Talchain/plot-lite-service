#!/usr/bin/env bash
set -euo pipefail
# Ensure self-start is cleaned up on any exit
SVR_PID=""
cleanup() {
  if [ -n "${SVR_PID:-}" ]; then
    echo "cleanup: stopping self-started server ($SVR_PID)"
    kill "$SVR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
BASE_PORT=${PORT:-4311}
ENGINE="http://127.0.0.1:${BASE_PORT}"
TEMPLATE="pricing_change"; SEED=101; FIXED_SEED=4242
NOW=$(date +"%Y%m%d-%H%M"); OUT="artifact/Evidence-Pack-$NOW"
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
mkdir -p "$OUT/engine" "$OUT/ui" "$OUT/reports"

echo "==> Optional self-start (PACK_SELF_START=1)"
# SVR_PID initialized above
if [ "${PACK_SELF_START:-0}" = "1" ]; then
  rm -f "$OUT/engine/selfstart.log" "$OUT/engine/selfstart.pid"
  # When PACK_EXTENDED=1, also enable FEATURE_STREAM=1 for real /stream during soak
  FEAT_STREAM_ENV=""; if [ "${PACK_EXTENDED:-0}" = "1" ]; then FEAT_STREAM_ENV="FEATURE_STREAM=1 "; fi
  echo "ENV: PORT(base)=${BASE_PORT} ${FEAT_STREAM_ENV}TEST_ROUTES=1 RATE_LIMIT_ENABLED=0" | tee "$OUT/engine/selfstart.env.txt" >/dev/null
  # Try up to +5 ports if busy
  READY=0
  for OFFSET in 0 1 2 3 4 5; do
    PORT_TRY=$((BASE_PORT+OFFSET))
    ENGINE="http://127.0.0.1:${PORT_TRY}"
    echo "--- starting test-server on ${PORT_TRY} ---" >> "$OUT/engine/selfstart.log"
    (env ${FEAT_STREAM_ENV} TEST_PORT=${PORT_TRY} TEST_ROUTES=1 RATE_LIMIT_ENABLED=0 node tools/test-server.js >>"$OUT/engine/selfstart.log" 2>&1 & echo $! >"$OUT/engine/selfstart.pid") || true
    SVR_PID=$(cat "$OUT/engine/selfstart.pid" 2>/dev/null || true)
    # Poll /health up to 10s
    for i in {1..40}; do
      if curl -sf "$ENGINE/health" >/dev/null; then echo "self-start ready on ${PORT_TRY}"; READY=1; break; fi; sleep 0.25;
    done
    if [ "$READY" = "1" ]; then break; fi
    # If server died immediately and likely port was busy, try next port
    if [ -n "$SVR_PID" ] && ! kill -0 "$SVR_PID" >/dev/null 2>&1; then
      if grep -qi "EADDRINUSE\|address already in use" "$OUT/engine/selfstart.log" 2>/dev/null; then
        echo "port ${PORT_TRY} busy; trying next";
        continue
      fi
    fi
  done
  if [ "$READY" != "1" ]; then
    echo "self-start failed to become ready on ${BASE_PORT}..$((BASE_PORT+5)) within 10s"
    echo "--- tail(selfstart.log) ---"
    tail -n 120 "$OUT/engine/selfstart.log" || true
    exit 3
  fi
  echo "ENV: PORT=${PORT_TRY} ${FEAT_STREAM_ENV}TEST_ROUTES=1 RATE_LIMIT_ENABLED=0" | tee -a "$OUT/engine/selfstart.env.txt" >/dev/null
fi

echo "==> Setup (build + unit)"; npm ci; npm run build || true

echo "==> Lanes (capture status)"
set +e
npm run typecheck; S_TYPECHECK=$?
npm run test:contracts; S_CONTRACTS=$?
npm run test:stream; S_STREAM=$?
npm run test:security; S_SECURITY=$?
npm run test:perf; S_PERF=$?
npm test; S_TEST=$?
set -e

echo "==> STRICT loadcheck"; STRICT_LOADCHECK=1 node tools/loadcheck-wrap.cjs || true
[ -f reports/warp/loadcheck.json ] && cp reports/warp/loadcheck.json "$OUT/reports/loadcheck.json"

echo "==> Determinism + ETag/304"
RATE_LIMIT_ENABLED=0 curl "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/draft-flows-200.h" -o "$OUT/engine/draft-flows-200.json"
ET=$(awk 'tolower($1)=="etag:"{print $2}' "$OUT/engine/draft-flows-200.h" | tr -d '\r')
RATE_LIMIT_ENABLED=0 curl -i -H "If-None-Match: ${ET}" "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/draft-flows-304.h" -o "$OUT/engine/draft-flows-304.txt"

echo "==> Capture fixed-seed ${FIXED_SEED} body for checksum"
RATE_LIMIT_ENABLED=0 curl -s "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${FIXED_SEED}" -o "$OUT/engine/draft-flows-${FIXED_SEED}.json" || true

echo "==> HEAD parity + 304"
RATE_LIMIT_ENABLED=0 curl -I "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/head-200.h" >/dev/null
RATE_LIMIT_ENABLED=0 curl -I -H "If-None-Match: ${ET}" "$ENGINE/draft-flows?template=${TEMPLATE}&seed=${SEED}" -D "$OUT/engine/head-304.h" >/dev/null

echo "==> Health + Version"
RATE_LIMIT_ENABLED=0 curl -s -D "$OUT/engine/health.h" "$ENGINE/health" -o "$OUT/engine/health.raw" || true
RATE_LIMIT_ENABLED=0 cat "$OUT/engine/health.raw" | jq . > "$OUT/engine/health.json" || true
# Capture /version headers (GET) and body; also capture HEAD headers for parity tests
RATE_LIMIT_ENABLED=0 curl -s "$ENGINE/version" -D "$OUT/engine/version-200.h" -o "$OUT/engine/version.json" || true
RATE_LIMIT_ENABLED=0 curl -s -I "$ENGINE/version" -D "$OUT/engine/version-head.h" >/dev/null || true

# Metrics snapshot when gated (best-effort)
if [ "${METRICS:-0}" = "1" ]; then
  echo "==> Metrics snapshot (gated)"
  RATE_LIMIT_ENABLED=0 curl -s "$ENGINE/metrics" -o "$OUT/engine/metrics.json" || true
fi

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
  if [ -f "$OUT/engine/draft-flows-${FIXED_SEED}.json" ]; then
    shasum -a 256 "$OUT/engine/draft-flows-${FIXED_SEED}.json" > "$OUT/engine/fixture-seed-${FIXED_SEED}.sha256" || true
  elif [ -f "fixtures/pricing_change/${FIXED_SEED}.json" ]; then
    shasum -a 256 "fixtures/pricing_change/${FIXED_SEED}.json" > "$OUT/engine/fixture-seed-${FIXED_SEED}.sha256" || true
  fi
  if [ -f "fixtures/golden-seed-4242/stream.ndjson" ]; then
    shasum -a 256 "fixtures/golden-seed-4242/stream.ndjson" > "$OUT/engine/stream-ndjson.sha256" || true
  fi
fi

echo "==> Access log snippet (if available)"
if [ -f "$OUT/engine/selfstart.log" ]; then
  tail -n 20 "$OUT/engine/selfstart.log" > "$OUT/engine/access-log-snippet.txt" || true
elif [ -n "${ENGINE_LOG_PATH:-}" ] && [ -f "$ENGINE_LOG_PATH" ]; then
  tail -n 20 "$ENGINE_LOG_PATH" > "$OUT/engine/access-log-snippet.txt" || true
else
  echo "no captured server log; run engine with stdout redirected to a file and set ENGINE_LOG_PATH to include a snippet" > "$OUT/engine/access-log-snippet.txt"
fi

echo "==> Summary README"
OUT_ABS=$(cd "$OUT" && pwd)
{
  echo "PLoT-lite Engine Evidence Pack";
  echo "time: $(date -u "+%Y-%m-%dT%H:%M:%SZ")";
  echo "commit: ${COMMIT}";
  echo "engine: ${ENGINE}";
  P95=$(jq -r '.p95_ms // empty' "$OUT/reports/loadcheck.json" 2>/dev/null || echo "");
  if [ -n "$P95" ] && [ "$P95" != "null" ]; then echo "p95_ms: $P95"; fi
  # lane statuses
  s() { test "$1" -eq 0 && echo PASS || echo FAIL; };
  echo "lanes: typecheck=$(s ${S_TYPECHECK:-0}), contracts=$(s ${S_CONTRACTS:-0}), stream=$(s ${S_STREAM:-0}), security=$(s ${S_SECURITY:-0}), perf=$(s ${S_PERF:-0}), test=$(s ${S_TEST:-0})";
  # acceptance checklist (coarse; relies on lanes + captures)
  ck() { test "$1" -eq 0 && echo "✅" || echo "❌"; };
  echo "checklist:";
  echo "- $(ck ${S_CONTRACTS:-0}) Contracts (SSE events, report.v1 stamp, health shape)";
  echo "- $(ck ${S_STREAM:-0}) Stream (resume via Last-Event-ID, idempotent cancel)";
  echo "- $(ck ${S_SECURITY:-0}) Security (no payload/query logs; headers; prod guard)";
  echo "- $(ck ${S_PERF:-0}) Performance (p95 ≤ 600 ms; 429 Retry-After; limited SSE)";
  echo "- $(ck ${S_TEST:-0}) Caching & taxonomy (ETag/304; HEAD parity; samples)";
  echo "notes: UI not required; engine-only pack";
  echo "out: ${OUT_ABS}";
} > "$OUT/README.txt"

# Repro commands for demos/debugging (best-effort)
echo "==> Repro commands"
node tools/repro.mjs "$ENGINE" > "$OUT/repro.txt" || true

# Extended captures (optional)
if [ "${PACK_EXTENDED:-0}" = "1" ]; then
  echo "==> Extended: soak/replay"
  # Run soak with modest defaults; respect AUTH_TOKEN if set
  SOAK_JSON="$OUT/reports/soak.json"
  (node tools/soak.mjs --base "$ENGINE" --n 5 --duration 20) > "$SOAK_JSON" 2>/dev/null || true
  # Run replay if NDJSON is available
  REPLAY_JSON="$OUT/reports/replay.json"; REPLAY_SRC="fixtures/golden-seed-4242/stream.ndjson"
  if [ -f "$REPLAY_SRC" ]; then
    (node tools/replay.mjs --file "$REPLAY_SRC") > "$REPLAY_JSON" 2>/dev/null || true
  fi
  # Mini rate soak (best-effort)
  RATE_SOAK_JSON="$OUT/reports/rate-soak.json"
  (node tools/rate-soak.mjs "$ENGINE") > "$RATE_SOAK_JSON" 2>/dev/null || true
  # Merge into extended.json (best-effort)
  EXT_JSON="$OUT/extended.json"
  {
    echo '{'
    echo '  "soak":'; cat "$SOAK_JSON" 2>/dev/null || echo '{}'; echo ','
    echo '  "replay":'; cat "$REPLAY_JSON" 2>/dev/null || echo '{}'
    echo ','
    echo '  "rate_soak":'; cat "$RATE_SOAK_JSON" 2>/dev/null || echo '{}'
    echo '}'
  } > "$EXT_JSON" || true
fi

# Manifest: list every file with size and sha256 (best-effort)
echo "==> Pack manifest"
{
  echo "# pack-manifest.txt";
  echo "# path,size_bytes,sha256";
  while IFS= read -r -d '' f; do
    rel="${f#$OUT/}";
    sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ' || echo 0);
    if command -v shasum >/dev/null 2>&1; then
      sum=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}');
    elif command -v sha256sum >/dev/null 2>&1; then
      sum=$(sha256sum "$f" 2>/dev/null | awk '{print $1}');
    else
      sum="na";
    fi
    echo "$rel,$sz,$sum";
  done < <(find "$OUT" -type f -print0)
} > "$OUT/pack-manifest.txt" || true

# JSON manifest + validation (add-only)
echo "==> Pack manifest (JSON)"
PACK_ENGINE_URL="$ENGINE" node tools/manifest-generate.mjs "$OUT" > "$OUT/manifest.json" || true
node tools/manifest-validate.mjs "$OUT/manifest.json" || { echo "manifest validation failed"; exit 1; }

if [ -n "$SVR_PID" ]; then
  echo "==> Stopping self-started server ($SVR_PID)";
  kill "$SVR_PID" >/dev/null 2>&1 || true
fi

echo "Evidence Pack ready: $OUT_ABS"
echo "Place any UI artefacts under $OUT/ui and Playwright report under $OUT/reports if applicable"
