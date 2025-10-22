# Emergency Stabilization - START HERE

## Execute in Order

```bash
chmod +x *.sh

# 1. Fix broken build
./FIX_NOW.sh

# 2. Create backup & reset
./PHASE1.sh

# 3. Create P2-1 PR
./PHASE2_P2-1.sh
git push -u origin feat/p2-1-clean-integration
```

## Files Created

- `FIX_NOW.sh` - Restores src/errors.ts, removes new files
- `PHASE1.sh` - Backup + reset to 50e88ef
- `PHASE2_P2-1.sh` - Cherry-pick P2-1, build, test, commit

## After P2-1 Merged

Create D1 PR manually:
```bash
git checkout main && git pull
git checkout -b feat/d1-determinism-envelope
BACKUP=$(git branch | grep backup | head -1 | xargs)
git checkout $BACKUP -- src/lib/jcs-hash.ts tests/d1-determinism.test.ts
npm run build && npx vitest run tests/d1-determinism.test.ts
git add . && git commit -m "feat(d1): JCS canonicalization"
git push -u origin feat/d1-determinism-envelope
```

## Status
- [ ] Phase 0: Emergency repair (FIX_NOW.sh)
- [ ] Phase 1: Backup & reset (PHASE1.sh)
- [ ] Phase 2: P2-1 PR (PHASE2_P2-1.sh)
- [ ] Phase 3: D1 PR (manual)
