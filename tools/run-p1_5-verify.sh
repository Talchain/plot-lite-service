#!/usr/bin/env bash
set -euo pipefail

only_gates() { sed -n 's/^GATES:.*/&/p'; }

# --- Focused tests (dot-only) ---
npx vitest run \
  tests/*health*test.ts \
  tests/*stream*test.ts \
  tests/*auth*demo*test.ts \
  tests/*trust-proxy*test.ts \
  tests/body.*additional-props*.test.ts \
  --reporter=dot

echo

# --- Gates (each must print exactly one GATES: line) ---
node tools/trust-proxy-gate.mjs       | only_gates
node tools/stream-rate-limit-gate.mjs | only_gates
node tools/ttff-collect.mjs           | only_gates
node tools/load-bench.mjs             | only_gates
node tools/provenance-gate.mjs        | only_gates

# --- Aggregator (one final line + exit code) ---
node tools/gates-status.mjs | only_gates
echo "aggregator_exit:$?"
