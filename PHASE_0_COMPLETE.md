# Phase 0: Emergency Repair - INSTRUCTIONS

## Execute Emergency Fix

```bash
chmod +x EMERGENCY_FIX.sh
./EMERGENCY_FIX.sh
```

## Manual Steps (if script fails)

### 1. Restore src/errors.ts
```bash
git checkout HEAD -- src/errors.ts
```

### 2. Restore route files
```bash
git checkout HEAD -- src/routes/v1/index.ts
git checkout HEAD -- src/routes/v1/stream.ts
```

### 3. Remove new files
```bash
rm -f src/lib/jcs-hash.ts
rm -f src/routes/v1/limits.ts
rm -f src/routes/v1/templates.ts
rm -f tests/a2-error-taxonomy.test.ts
rm -f tests/d1-determinism.test.ts
rm -f tests/l1-limits.test.ts
rm -f tests/t1-templates.test.ts
```

### 4. Build & Test
```bash
npm run build
npx vitest run tests/p2-1-canary.test.ts
```

## Phase 1: Create Backup & Reset

```bash
# Create backup
git branch backup/main-with-features-$(date +%Y%m%d)

# Reset to stable baseline
git reset --hard 50e88ef

# Verify
git log --oneline -5
```

## Phase 2: P2-1 Clean Integration

```bash
# Create branch
git checkout -b feat/p2-1-clean-integration

# Cherry-pick P2-1 files from backup
git checkout backup/main-with-features-* -- src/metrics.ts
git checkout backup/main-with-features-* -- src/plugins/metrics.ts
git checkout backup/main-with-features-* -- src/routes/v1/stream.ts
git checkout backup/main-with-features-* -- tests/p2-1-canary.test.ts

# Build & Test
npm run build
npx vitest run tests/p2-1-canary.test.ts

# Commit
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts
git commit -m "feat(p2-1): add stream canary header + metrics"
git push -u origin feat/p2-1-clean-integration
```

## Status

- [ ] Phase 0: Emergency repair
- [ ] Phase 1: Backup & reset
- [ ] Phase 2: P2-1 PR
- [ ] Phase 3: D1 PR
- [ ] Phase 4: A2 PR (deferred)
