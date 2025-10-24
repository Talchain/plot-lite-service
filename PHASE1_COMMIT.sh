#!/bin/bash
# Phase 1: Commit P2-1 Clean Integration

git checkout -b feat/p2-1-clean-integration

git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts

git commit -m "feat(p2-1): add stream canary header + metrics (clean integration)

- Canonical header: X-Enable-Enhanced-Stream
- Legacy header: X-Stream-Enhanced (deprecated)
- Metrics: plot_engine_stream_canary_total, plot_engine_stream_deprecated_header_total
- Tests: canonical/legacy headers, case-insensitive truthy
- Preserves P1 SSE stability (EPIPE) and CI gates"

git add docs/feature-p2-1-stream-canary.md P2-1_*.md

git commit -m "docs(p2-1): feature spec and reconciliation docs"

echo "✅ Phase 1 commits ready. Run: git push -u origin feat/p2-1-clean-integration"
