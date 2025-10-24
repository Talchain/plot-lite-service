#!/usr/bin/env bash
set -euo pipefail

N=${1:-10}
echo "Running test suite $N times..."

for i in $(seq 1 $N); do
  echo "== RUN $i/$N =="
  npx vitest run --reporter=dot 2>&1 | tee ".ci-run$i.txt" | tail -5 || true
  echo ""
done

echo "Analysis:"
node tools/baseline/analyze.mjs
