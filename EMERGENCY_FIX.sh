#!/bin/bash
# Emergency: Restore errors.ts to HEAD
git checkout HEAD -- src/errors.ts

# Remove new routes from index
git checkout HEAD -- src/routes/v1/index.ts

# Remove S1 changes from stream
git checkout HEAD -- src/routes/v1/stream.ts

# Delete new files not in HEAD
rm -f src/lib/jcs-hash.ts
rm -f src/routes/v1/limits.ts
rm -f src/routes/v1/templates.ts
rm -f tests/a2-error-taxonomy.test.ts
rm -f tests/d1-determinism.test.ts
rm -f tests/l1-limits.test.ts
rm -f tests/t1-templates.test.ts

# Build
npm run build

# Test P2-1
npx vitest run tests/p2-1-canary.test.ts

echo "✅ Emergency repair complete"
