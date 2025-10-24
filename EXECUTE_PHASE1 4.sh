#!/bin/bash
# Phase 1: Commit P2-1 Clean Integration

set -e

echo "=== Phase 1: P2-1 Clean Integration ==="

# Create branch
git checkout -b feat/p2-1-clean-integration

# Add P2-1 files only
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts

# Commit code + tests
git commit -m "feat(p2-1): add stream canary header + metrics

- Canonical header: X-Enable-Enhanced-Stream
- Legacy header: X-Stream-Enhanced (deprecated)
- Metrics: plot_engine_stream_canary_total, plot_engine_stream_deprecated_header_total
- Tests: canonical/legacy, case-insensitive truthy, no-header compat
- Preserves P1 SSE stability (EPIPE) and CI gates"

# Optional: Add docs
if [ -f "docs/feature-p2-1-stream-canary.md" ]; then
  git add docs/feature-p2-1-stream-canary.md P2-1_*.md
  git commit -m "docs(p2-1): feature spec and reconciliation docs"
fi

# Verify
echo ""
echo "=== Verification ==="
npm run build
npx vitest run --threads=false tests/p2-1-canary.test.ts
git ls-files | grep '^src/.*\.js$' && echo "❌ JS artifacts found!" || echo "✅ No JS artifacts"

echo ""
echo "=== Ready to push ==="
echo "Run: git push -u origin feat/p2-1-clean-integration"
echo ""
echo "PR Evidence needed:"
echo "1. curl -i -H 'X-Enable-Enhanced-Stream: 1' \$BASE/v1/stream?demo=1 | head -20"
echo "2. curl -i -H 'X-Stream-Enhanced: TRUE' \$BASE/v1/stream?demo=1 | head -20"
echo "3. curl -s \$BASE/metrics | grep -E 'plot_engine_stream_(canary|deprecated_header)_total'"
