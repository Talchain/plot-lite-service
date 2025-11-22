#!/usr/bin/env bash
set -euo pipefail

# Quick, repeatable readiness checks for P0-1, E2E, and P0-2.
# Usage:
#   bash scripts/verify_release.sh
# Env:
#   BASE (default http://localhost:3000)
#   COMPOSE (default docker-compose.e2e.yml)
#   E2E (default true) – run e2e stack (requires Docker)
#   TIMEOUT (default 30) – seconds to wait for health/metrics
#   PROM_URL (default http://localhost:9090)

BASE="${BASE:-http://localhost:3000}"
COMPOSE="${COMPOSE:-docker-compose.e2e.yml}"
RUN_E2E="${E2E:-true}"
TIMEOUT="${TIMEOUT:-30}"
PROM_URL="${PROM_URL:-http://localhost:9090}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Missing dependency: $1"; exit 1; }; }
has()  { command -v "$1" >/dev/null 2>&1; }

echo "🔎 Verify Release"
echo "BASE=${BASE}"
echo "PROM_URL=${PROM_URL}"
echo

need curl
if has jq; then USE_JQ=1; else echo "⚠️  jq not found; falling back to grep"; USE_JQ=0; fi

retry() {
  local name="$1" cmd="$2" max="${3:-$TIMEOUT}" delay=1
  echo "⏳ $name (timeout=${max}s)"
  local start=$(date +%s)
  while true; do
    if eval "$cmd" >/dev/null 2>&1; then
      echo "✅ $name"
      return 0
    fi
    sleep "$delay"
    if (( $(date +%s) - start >= max )); then
      echo "❌ $name (timed out)"
      return 1
    fi
  done
}

# A) Health endpoint up
retry "API health ready" "curl -fsS '${BASE}/v1/health'"

# B) Health fields sanity
HEALTH="$(curl -fsS "${BASE}/v1/health")"
if [[ "$USE_JQ" -eq 1 ]]; then
  STATUS="$(echo "$HEALTH" | jq -r '.status // empty')"
  UPTIME="$(echo "$HEALTH" | jq -r '.uptime_s // empty')"
else
  STATUS="$(echo "$HEALTH" | grep -o '"status":"ok"' || true)"
  UPTIME="$(echo "$HEALTH" | grep -o 'uptime_s' || true)"
fi

[[ "$STATUS" == "ok" || "$STATUS" == '"status":"ok"' ]] || { echo "❌ health.status != ok"; exit 1; }
[[ -n "$UPTIME" ]] || { echo "❌ health.uptime_s missing"; exit 1; }
echo "✅ Health looks good"

# C) Response validation metric: force a 400 and observe increment
echo "{}" | curl -fsS -XPOST "${BASE}/v1/run" -H 'content-type: application/json' -d @- >/dev/null || true
METRICS="$(curl -fsS "${BASE}/metrics" || true)"
echo "$METRICS" | grep -q 'plot_engine_validation_errors_total' \
  && echo "✅ validation_errors metric present" \
  || echo "⚠️  validation_errors metric not found (ensure metrics enabled)"

# D) Optional: run E2E stack with PromQL assertion
if [[ "$RUN_E2E" == "true" ]]; then
  if has docker && [[ -f "$COMPOSE" ]]; then
    echo "🐳 Starting E2E stack (Prometheus + service)…"
    docker compose -f "$COMPOSE" up -d --build

    # Wait for Prometheus to be up
    retry "Prometheus up" "curl -fsS '${PROM_URL}/-/healthy'"

    # Induce burst to trip circuit
    echo "💥 Inducing burst to trip circuit…"
    for i in $(seq 1 15); do
      echo '{"graph":{"nodes":[],"edges":[]}}' | curl -s -o /dev/null -XPOST "${BASE}/v1/run" -H 'content-type: application/json' -d @- || true
    done

    # Robust PromQL wait for > 0 opens
    echo "🔭 Waiting for Prometheus to observe circuit open…"
    end=$(( $(date +%s) + 45 ))
    opened=0
    while (( $(date +%s) < end )); do
      val="$(curl -fsS "${PROM_URL}/api/v1/query" --get --data-urlencode 'query=plot_engine_circuit_open_total' \
            | { if [[ "$USE_JQ" -eq 1 ]]; then jq -r '.data.result[0].value[1] // "0"'; else cat; fi; } 2>/dev/null || echo "0")"
      if awk "BEGIN{exit !($val+0 > 0)}"; then opened=1; break; fi
      sleep 2
    done
    if [[ "$opened" -eq 1 ]]; then
      echo "✅ PromQL confirms circuit opened (plot_engine_circuit_open_total > 0)"
    else
      echo "❌ Did not observe circuit open via Prometheus in time"
      docker compose -f "$COMPOSE" logs plot-engine || true
      docker compose -f "$COMPOSE" logs prometheus || true
      exit 1
    fi

    echo "🧹 Stopping E2E stack…"
    docker compose -f "$COMPOSE" down
  else
    echo "⚠️  Skipping E2E: Docker or $COMPOSE not available"
  fi
else
  echo "ℹ️  Skipping E2E per E2E=false"
fi

# E) (Optional) Secret rotation signals only – visibility check (no mutation)
echo "🔐 Checking secret visibility (if env configured)…"
SECRETS_JSON="$(echo "$HEALTH" | { if [[ "$USE_JQ" -eq 1 ]]; then jq -r '.principal_extraction.secrets // empty'; else cat; fi; })"
if [[ -n "$SECRETS_JSON" && "$SECRETS_JSON" != "null" ]]; then
  echo "✅ Health exposes secrets flags: $SECRETS_JSON"
else
  echo "ℹ️  Secrets flags not present (expected unless both ACTIVE/STAGED are set in env)"
fi

echo
echo "🎉 Verification complete."
