# Quick Start: Create All PRs

## Pre-flight Check
```bash
npm ci
npm run build
npm test
git ls-files | grep '^src/.*\.js$' || echo "✅ No artifacts"
```

## PR 1: P2-1 Stream Canary
```bash
git checkout main
git pull
git checkout -b feat/p2-1-clean-integration
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts
git commit -m "feat(p2-1): add stream canary header + metrics"
git push -u origin feat/p2-1-clean-integration
```

## PR 2: A2 Error Taxonomy
```bash
git checkout main
git pull
git checkout -b feat/a2-error-taxonomy
git add src/errors.ts tests/a2-error-taxonomy.test.ts
git commit -m "feat(a2): closed-set error taxonomy"
git push -u origin feat/a2-error-taxonomy
```

## PR 3: D1 Determinism
```bash
git checkout main
git pull
git checkout -b feat/d1-determinism-envelope
git add src/lib/jcs-hash.ts tests/d1-determinism.test.ts
git commit -m "feat(d1): JCS canonicalization + deterministic hashing"
git push -u origin feat/d1-determinism-envelope
```

## PR 4: L1 Limits
```bash
git checkout main
git pull
git checkout -b feat/l1-limits-endpoint
git add src/routes/v1/limits.ts tests/l1-limits.test.ts src/routes/v1/index.ts
git commit -m "feat(l1): add /v1/limits endpoint with ETag"
git push -u origin feat/l1-limits-endpoint
```

## PR 5: T1 Templates
```bash
git checkout main
git pull
git checkout -b feat/t1-templates-registry
git add src/routes/v1/templates.ts tests/t1-templates.test.ts src/routes/v1/index.ts
git commit -m "feat(t1): add templates registry endpoints"
git push -u origin feat/t1-templates-registry
```

## PR 6: S1 SSE Hardening
```bash
git checkout main
git pull
git checkout -b feat/s1-sse-hardening
git add src/routes/v1/stream.ts
git commit -m "feat(s1): SSE security hardening"
git push -u origin feat/s1-sse-hardening
```

## Test Each Phase
```bash
npx vitest run --threads=false tests/p2-1-canary.test.ts
npx vitest run --threads=false tests/a2-error-taxonomy.test.ts
npx vitest run --threads=false tests/d1-determinism.test.ts
npx vitest run --threads=false tests/l1-limits.test.ts
npx vitest run --threads=false tests/t1-templates.test.ts
```

## Evidence Collection
```bash
# Start server
PORT=3500 PROMETHEUS_ENABLE=1 AUTH_ENABLED=0 node dist/main.js &

# P2-1
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20
curl -s http://localhost:3500/metrics | grep plot_engine_stream

# L1
curl -i http://localhost:3500/v1/limits
etag=$(curl -si http://localhost:3500/v1/limits | awk '/[Ee][Tt]ag:/ {print $2}')
curl -i -H "If-None-Match: $etag" http://localhost:3500/v1/limits | head -5

# T1
curl -s http://localhost:3500/v1/templates | jq
curl -s http://localhost:3500/v1/templates/pricing-change-v1 | jq '.id, .default_seed'

# Cleanup
kill %1
```

## Summary
- ✅ 6 PRs ready
- ✅ 12 files created/modified
- ✅ All tests written
- ✅ Evidence commands provided
- ✅ No artifacts
- ✅ P1 fixes preserved
