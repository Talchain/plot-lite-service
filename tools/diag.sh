#!/usr/bin/env bash
set -euo pipefail

# Quick diagnostics pipeline (read-only where possible)
# - typecheck, unit tests (non-fatal)
# - self-start Evidence Pack (non-fatal)
# - ci-assert (non-fatal)
# - print latest pack path, summary, and server tail

echo "== Node/npm =="
node -v || true
npm -v || true

echo "== Typecheck =="
npm run typecheck || true

echo "== Tests (full) =="
npm test || true

echo "== Evidence Pack (self-start) =="
PACK_SELF_START=1 bash tools/verify-and-pack.sh || true

echo "== CI Assertions =="
node tools/ci-assert.mjs || true

echo "== Latest Pack =="
PACK_PATH="$(node tools/pack-locate.mjs || true)"
if [ -z "${PACK_PATH}" ] || [ "${PACK_PATH}" = "<none>" ]; then
  echo "Latest pack: <none>"
  exit 0
fi

echo "Latest pack: ${PACK_PATH}"
if [ -f "${PACK_PATH}/pack-summary.json" ]; then
  echo "-- pack-summary.json --"
  cat "${PACK_PATH}/pack-summary.json"
fi

if [ -f "${PACK_PATH}/engine/selfstart.log" ]; then
  echo "-- tail(selfstart.log) --"
  tail -n 120 "${PACK_PATH}/engine/selfstart.log" || true
fi
