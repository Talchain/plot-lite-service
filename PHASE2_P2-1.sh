#!/bin/bash
set -e

echo "Phase 2: P2-1 Stream Canary PR"

# Create branch
git checkout -b feat/p2-1-clean-integration

# Get backup branch name
BACKUP=$(git branch | grep backup/main-with-features | head -1 | xargs)

# Cherry-pick P2-1 files
git checkout $BACKUP -- src/metrics.ts
git checkout $BACKUP -- src/plugins/metrics.ts
git checkout $BACKUP -- src/routes/v1/stream.ts
git checkout $BACKUP -- tests/p2-1-canary.test.ts

# Build & Test
npm run build
npx vitest run tests/p2-1-canary.test.ts

# Commit
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts
git commit -m "feat(p2-1): add stream canary header + metrics"

echo "✅ Phase 2 complete"
echo "Ready to push: git push -u origin feat/p2-1-clean-integration"
