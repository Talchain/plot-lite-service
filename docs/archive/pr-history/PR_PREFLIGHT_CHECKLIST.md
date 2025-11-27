# PR Pre-flight Checklist

Run this for each PR before opening:

## ✅ Build & Test
```bash
npm ci && npm run build
npm test  # No .only, no flaky skips
```

## ✅ Type Check
- TypeScript errors: 0
- No `src/*.js` artifacts tracked

## ✅ Security & Ops
- [ ] Bounded metrics labels (no high cardinality)
- [ ] No secrets/tokens in logs (grep check)
- [ ] `npm audit --production` clean or waivers documented
- [ ] Rollback = single-commit revert noted in PR

## ✅ Proofs (attach outputs to PR)

### P2-1 (Stream Canary)
```bash
PORT=3500 PROMETHEUS_ENABLE=1 node dist/main.js &
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20
curl -s http://localhost:3500/metrics | grep -E "plot_engine_stream_(canary|deprecated_header)_total"
kill %1
```

### P2 (Determinism)
```bash
for i in {1..5}; do curl -s "http://localhost:3500/v1/run?template_id=t&seed=1337"; done \
| jq -r '.model_card.response_hash' | sort | uniq -c
```

### P3 (ETag Caching)
```bash
ETAG=$(curl -isS http://localhost:3500/v1/limits | awk '/^ETag:/ {print $2}' | tr -d '\r')
curl -isS -H "If-None-Match: $ETAG" http://localhost:3500/v1/limits | head -5
```

### P1 (Error Envelope)
```bash
# Rate limited (429 + headers)
PORT=3501 RATE_LIMIT_ENABLED=1 RATE_LIMIT_MAX=2 AUTH_ENABLED=0 node dist/main.js &
for i in 1 2 3; do curl -s "http://localhost:3501/v1/run" | jq '.schema,.code,.retry_after'; done
curl -i "http://localhost:3501/v1/run" | grep -E "Retry-After|X-RateLimit-Reset"
kill %1
```

### P4 (SSE Hygiene)
```bash
# Unit tests only (integration pending)
npx vitest run tests/p4-sse-hygiene.unit.test.ts
```

---

## 📋 Reviewer Checklist (paste in each PR)

```markdown
## Reviewer Checklist

- [ ] Diff is surgical; one concern per PR
- [ ] Contract matches UI brief (error.v1, determinism, caching, SSE)
- [ ] Tests cover success + edge cases; proofs reproduced
- [ ] Observability in place; logs are non-sensitive
- [ ] Backward compatibility documented (esp. P1)
- [ ] Build is clean; `npm test` stable; no `.only`
- [ ] No `src/*.js` tracked; lint/format pass
- [ ] New code is modular (helpers isolated), typed, and covered
- [ ] Headers & caching semantics exactly match brief
- [ ] No high-cardinality metrics; no secrets in logs/metrics
- [ ] Proof commands reproduced as-advertised
- [ ] Rollback plan is trivial (single revert)
```
