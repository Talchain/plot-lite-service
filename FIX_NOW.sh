#!/bin/bash
set -e

echo "Phase 0: Emergency Repair"

# Restore original files
git checkout HEAD -- src/errors.ts
git checkout HEAD -- src/routes/v1/index.ts
git checkout HEAD -- src/routes/v1/stream.ts

# Remove new files
rm -f src/lib/jcs-hash.ts src/routes/v1/limits.ts src/routes/v1/templates.ts
rm -f tests/a2-error-taxonomy.test.ts tests/d1-determinism.test.ts
rm -f tests/l1-limits.test.ts tests/t1-templates.test.ts

# Build
npm run build

echo "✅ Phase 0 complete"
echo ""
echo "Next: Run ./PHASE1.sh"
