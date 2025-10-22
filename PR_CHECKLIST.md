# PR Creation Checklist

## Pre-Flight (Do Once)

- [ ] `npm ci` - Clean install
- [ ] `npm run build` - Verify build succeeds
- [ ] `npm test` - Run full test suite
- [ ] `git ls-files | grep '^src/.*\.js$'` - Verify no artifacts (should be empty)
- [ ] `git status` - Verify clean working directory

## PR 1: P2-1 Stream Canary

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/p2-1-clean-integration`
- [ ] `git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts`
- [ ] `git commit -m "feat(p2-1): add stream canary header + metrics"`
- [ ] `git push -u origin feat/p2-1-clean-integration`

### Test
- [ ] `npx vitest run --threads=false tests/p2-1-canary.test.ts`

### Evidence (for PR body)
```bash
PORT=3500 PROMETHEUS_ENABLE=1 AUTH_ENABLED=0 node dist/main.js &
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20
curl -i -H "X-Stream-Enhanced: TRUE" "http://localhost:3500/v1/stream?demo=1" | head -20
curl -s http://localhost:3500/metrics | grep -E "plot_engine_stream_(canary|deprecated_header)_total"
kill %1
```

### PR Description
- [ ] Copy from `PR_P2-1_DESCRIPTION.md` (if exists) or use template below
- [ ] Include evidence output
- [ ] Link to `docs/feature-p2-1-stream-canary.md`

---

## PR 2: A2 Error Taxonomy

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/a2-error-taxonomy`
- [ ] `git add src/errors.ts tests/a2-error-taxonomy.test.ts`
- [ ] `git commit -m "feat(a2): closed-set error taxonomy"`
- [ ] `git push -u origin feat/a2-error-taxonomy`

### Test
- [ ] `npx vitest run --threads=false tests/a2-error-taxonomy.test.ts`

### PR Description Points
- Closed-set codes: BAD_INPUT, LIMIT_EXCEEDED, RATE_LIMITED, UNAUTHORIZED, SERVER_ERROR
- Helper functions with clamping
- Comprehensive test coverage
- No breaking changes

---

## PR 3: D1 Determinism

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/d1-determinism-envelope`
- [ ] `git add src/lib/jcs-hash.ts tests/d1-determinism.test.ts`
- [ ] `git commit -m "feat(d1): JCS canonicalization + deterministic hashing"`
- [ ] `git push -u origin feat/d1-determinism-envelope`

### Test
- [ ] `npx vitest run --threads=false tests/d1-determinism.test.ts`

### Evidence
```bash
# 5× determinism proof
for i in {1..5}; do 
  curl -s -X POST http://localhost:3500/v1/run \
    -H "Content-Type: application/json" \
    -d '{"seed":4242,"graph":{"nodes":[{"id":"a"}],"edges":[]}}' | \
    jq -r '.model_card.response_hash'
done | sort | uniq -c
```

### PR Description Points
- RFC 8785 JCS compliant
- SHA-256 hashing
- Key order invariant
- 5× identical hash proof

---

## PR 4: L1 Limits

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/l1-limits-endpoint`
- [ ] `git add src/routes/v1/limits.ts tests/l1-limits.test.ts src/routes/v1/index.ts`
- [ ] `git commit -m "feat(l1): add /v1/limits endpoint with ETag"`
- [ ] `git push -u origin feat/l1-limits-endpoint`

### Test
- [ ] `npx vitest run --threads=false tests/l1-limits.test.ts`

### Evidence
```bash
curl -i http://localhost:3500/v1/limits
etag=$(curl -si http://localhost:3500/v1/limits | awk '/[Ee][Tt]ag:/ {print $2}')
curl -i -H "If-None-Match: $etag" http://localhost:3500/v1/limits | head -5
```

### PR Description Points
- Returns max_nodes:12, max_edges:20
- ETag + 304 support
- Cache-Control: max-age=60
- UI can enforce limits client-side

---

## PR 5: T1 Templates

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/t1-templates-registry`
- [ ] `git add src/routes/v1/templates.ts tests/t1-templates.test.ts src/routes/v1/index.ts`
- [ ] `git commit -m "feat(t1): add templates registry endpoints"`
- [ ] `git push -u origin feat/t1-templates-registry`

### Test
- [ ] `npx vitest run --threads=false tests/t1-templates.test.ts`

### Evidence
```bash
curl -s http://localhost:3500/v1/templates | jq
curl -s http://localhost:3500/v1/templates/pricing-change-v1 | jq '.id, .default_seed, .graph'
```

### PR Description Points
- GET /v1/templates - list all
- GET /v1/templates/:id - full template
- ETag + 304 support
- Sample: pricing-change-v1

---

## PR 6: S1 SSE Hardening

### Create Branch & Commit
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b feat/s1-sse-hardening`
- [ ] `git add src/routes/v1/stream.ts`
- [ ] `git commit -m "feat(s1): SSE security hardening"`
- [ ] `git push -u origin feat/s1-sse-hardening`

### Test
- [ ] `npx vitest run --threads=false tests/p2-1-canary.test.ts` (verify no regression)

### Evidence
```bash
curl -i http://localhost:3500/v1/stream?demo=1 | head -15
# Verify: Cache-Control: no-store, Referrer-Policy: no-referrer, retry: 1500
```

### PR Description Points
- Cache-Control: no-store
- Referrer-Policy: no-referrer
- retry: 1500 directive
- Preserves P2-1 canary headers

---

## Post-PR Actions

### After Each PR Created
- [ ] Verify CI passes
- [ ] Request review
- [ ] Monitor for feedback

### After Each PR Merged
- [ ] Pull latest main
- [ ] Verify feature works in main
- [ ] Update local branches

### After All PRs Merged
- [ ] Full smoke test
- [ ] Update team documentation
- [ ] Notify UI team of new endpoints
- [ ] Monitor metrics

---

## Quick Reference

**Files Modified by Phase**:
- P2-1: 4 files (metrics, stream route, tests)
- A2: 2 files (errors, tests)
- D1: 2 files (jcs-hash, tests)
- L1: 3 files (limits route, tests, index)
- T1: 3 files (templates route, tests, index)
- S1: 1 file (stream route)

**Test Commands**:
```bash
# Individual
npx vitest run --threads=false tests/p2-1-canary.test.ts
npx vitest run --threads=false tests/a2-error-taxonomy.test.ts
npx vitest run --threads=false tests/d1-determinism.test.ts
npx vitest run --threads=false tests/l1-limits.test.ts
npx vitest run --threads=false tests/t1-templates.test.ts

# All
npm test
```

**No Artifacts Check**:
```bash
git ls-files | grep '^src/.*\.js$' || echo "✅ Clean"
```

---

## Troubleshooting

### Build Fails
1. Check TypeScript errors: `npm run build`
2. Verify imports are correct
3. Check for missing dependencies

### Tests Fail
1. Run specific test: `npx vitest run --threads=false tests/<file>`
2. Check test output for details
3. Verify server starts: `node dist/main.js`

### Git Issues
1. Stash changes: `git stash`
2. Clean checkout: `git checkout main && git pull`
3. Reapply: `git stash pop`

---

**Status**: Ready to execute ✅
