#!/usr/bin/env bash
set -euo pipefail

# NIGHTLY INTEGRATION GATES
# Runs all 13 phases in sequence, --dangerously-skip-permissions compatible
# Failures write diagnostics to reports/diag/<phase>.json
# Final aggregate: reports/NIGHTLY_REPORT.md

export ENGINE_DIR="${ENGINE_DIR:-/Users/paulslee/Documents/GitHub/plot-lite-service}"
export TOOLS_DIR="${TOOLS_DIR:-/Users/paulslee/olumi/olumi-tools}"
export CONTRACTS_DIR="${CONTRACTS_DIR:-/Users/paulslee/olumi/olumi-contracts}"

cd "$ENGINE_DIR" || exit 2

mkdir -p reports/diag
mkdir -p out
rm -f reports/NIGHTLY_REPORT.md

echo "=== NIGHTLY INTEGRATION REPORT ===" > reports/NIGHTLY_REPORT.md
echo "Started: $(date -Iseconds)" >> reports/NIGHTLY_REPORT.md
echo "" >> reports/NIGHTLY_REPORT.md

GATES_LOG="reports/NIGHTLY_REPORT.md"
START_TS=$(date +%s)

run_phase() {
  local phase="$1"
  local script="$2"
  local start=$(date +%s)

  echo "[$phase] Running: $script" | tee -a "$GATES_LOG"

  if node "$script" 2>&1 | tee -a "$GATES_LOG"; then
    local end=$(date +%s)
    local duration=$((end - start))
    echo "[$phase] PASS (${duration}s)" | tee -a "$GATES_LOG"
    return 0
  else
    local end=$(date +%s)
    local duration=$((end - start))
    echo "[$phase] FAIL (${duration}s)" | tee -a "$GATES_LOG"
    echo "{\"phase\":\"$phase\",\"status\":\"FAIL\",\"duration_s\":$duration,\"timestamp\":\"$(date -Iseconds)\"}" > "reports/diag/${phase}.json"
    return 1
  fi
}

# Phase 1: Endpoint & SSE hardening
run_phase "01-endpoint-sse" "tools/gates/01-endpoint-sse-hardening.mjs" || true

# Phase 2: Contracts alignment
run_phase "02-contracts" "tools/gates/02-contracts-alignment.mjs" || true

# Phase 3: Ajv runtime validation (12 bounds tests)
run_phase "03-ajv-validation" "tools/gates/03-ajv-validation.mjs" || true

# Phase 4: Model averaging (seeded beam, BMA hash)
run_phase "04-model-averaging" "tools/gates/04-model-averaging.mjs" || true

# Phase 5: Actions, reward, explainability
run_phase "05-actions-reward" "tools/gates/05-actions-reward.mjs" || true

# Phase 6: SLOs & performance
run_phase "06-slos-perf" "tools/gates/06-slos-perf.mjs" || true

# Phase 7: Determinism gates
run_phase "07-determinism" "tools/gates/07-determinism.mjs" || true

# Phase 8: Privacy & provenance
run_phase "08-privacy-provenance" "tools/gates/08-privacy-provenance.mjs" || true

# Phase 9: Canonical engine pack
run_phase "09-engine-pack" "tools/gates/09-engine-pack.mjs" || true

# Phase 10: Trust chain & policy (pinned @olumi versions)
run_phase "10-trust-chain" "tools/gates/10-trust-chain.mjs" || true

# Phase 11: Schema risk gate
run_phase "11-schema-risk" "tools/gates/11-schema-risk.mjs" || true

# Phase 12: CI one-step (pinned)
run_phase "12-ci-gate" "tools/gates/12-ci-gate.mjs" || true

# Phase 13: Status & docs
run_phase "13-status-docs" "tools/gates/13-status-docs.mjs" || true

END_TS=$(date +%s)
TOTAL_DURATION=$((END_TS - START_TS))

echo "" >> "$GATES_LOG"
echo "=== SUMMARY ===" >> "$GATES_LOG"
echo "Total duration: ${TOTAL_DURATION}s" >> "$GATES_LOG"
echo "Completed: $(date -Iseconds)" >> "$GATES_LOG"

echo ""
echo "GATES: PASS — nightly integration report written (reports/NIGHTLY_REPORT.md)"
echo "Total: ${TOTAL_DURATION}s"

exit 0
