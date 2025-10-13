#!/usr/bin/env bash
set -euo pipefail

# -------- helpers --------
only_gates='sed -n "s/^GATES:.*/&/p"'

# 0) Build + focused tests (quiet except failures)
npm run build >/dev/null

npx vitest run \
  tests/stream.query.validation.test.ts \
  tests/stream.latency.test.ts \
  tests/identifiability.dsep.props.test.ts \
  tests/identifiability.multi-set.test.ts \
  tests/identifiability.rules.test.ts \
  tests/hash.invariants.test.ts \
  tests/selfcheck.parity.test.ts \
  tests/auth.v1.routes.test.ts \
  --reporter=dot

# 1) Perf + rollout bench + pack
npm run perf:collect >/dev/null
node tools/rollout-bench.mjs         | eval "$only_gates"
# capture pack tool's single GATES line too
npm run pack:engine                  | eval "$only_gates" || true

# 2) Smokes & gates — each prints exactly one GATES line
node tools/sdk-smoke.mjs             | eval "$only_gates"
node tools/chaos-smoke.mjs           | eval "$only_gates"
node tools/chaos-auth-smoke.mjs      | eval "$only_gates"
node tools/ttff-collect.mjs          | eval "$only_gates"
node tools/load-bench.mjs            | eval "$only_gates"
node tools/rollout-threshold-gate.mjs| eval "$only_gates"
node tools/contract-drift-gate.mjs   | eval "$only_gates"
node tools/slo-budget-gate.mjs       | eval "$only_gates"
node tools/privacy-gate.mjs          | eval "$only_gates"
node tools/self-check-gate.mjs       | eval "$only_gates"
node tools/health-gate.mjs           | eval "$only_gates"
node tools/provenance-gate.mjs       | eval "$only_gates"
node tools/gates-status.mjs          | eval "$only_gates"
