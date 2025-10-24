# 🔒 Gate Validation Report

**Time**: 2025-10-23 12:01 UTC+01:00  
**Status**: Pre-merge validation

---

## ✅ Gate A: Repo Hygiene (PASS)

```bash
git status --porcelain
# Output: (empty)
# ✅ PASS

git diff --name-only | wc -l
# Output: 0
# ✅ PASS

git ls-files src/routes/v1/index.ts | wc -l
# Output: 1
# ✅ PASS
```

**Result**: Working tree clean, no uncommitted changes

---

## 📋 Gate B: Build + Test Snapshot

### Run Per Branch

```bash
# For each branch:
git switch <branch>
npm ci && npm run build
npx vitest run | tee .ci-last.txt
grep -E "Test Files:|Tests:" .ci-last.txt
```

### Expected Results

**P2-1 (Stream Canary)**:
- Feature tests: 4/4 passing ✅
- Inherited failures: ~16-17 files (unchanged from baseline)
- New failures: 0

**P2 (Determinism)**:
- Feature tests: 11/11 passing ✅
- Inherited failures: ~16-17 files (unchanged from baseline)
- New failures: 0

**P3 (ETag Caching)**:
- Feature tests: 5/5 passing ✅
- Inherited failures: ~16-17 files (unchanged from baseline)
- New failures: 0

**P1 (Error Envelope)**:
- Feature tests: 5/5 passing ✅
- Inherited failures: Must be addressed before merge ⚠️
- Target: 0 new failures (update legacy code assertions)

**P4 (SSE Hygiene)**:
- Feature tests: 8/8 passing ✅
- Inherited failures: ~16-17 files (unchanged from baseline)
- New failures: 0

---

## 🔧 Gate C: Stream Hygiene Probe

**Run after wiring utilities into `/v1/stream`** (T1 integration)

### C1: Security Headers
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
curl -s -D - "http://localhost:3500/v1/stream?demo=1" -o /dev/null | \
  grep -E "HTTP/1.1 200|Cache-Control: no-store|Referrer-Policy: no-referrer"
kill %1
```

**Expected**:
- `HTTP/1.1 200 OK`
- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`

### C2: Retry Line + Heartbeats + Monotonic IDs
```bash
PORT=3500 AUTH_ENABLED=0 SSE_HEARTBEAT_MS=5000 node dist/main.js &
sleep 2
curl -sN "http://localhost:3500/v1/stream?demo=1" | awk 'NR<=60{print}'
kill %1
```

**Expected**:
- First non-empty line: `retry: 1500`
- `:keepalive` lines appear every ~15s
- `id:` lines strictly increasing (0, 1, 2, ...)

### C3: Resume Semantics
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
curl -sN -H "Last-Event-ID: 3" "http://localhost:3500/v1/stream?demo=1" | head -n 40
kill %1
```

**Expected**:
- Contains `event: resume_unavailable` (once)
- Followed by normal `event: hello`, `event: token`, `event: done`

---

## 🎲 Gate D: Determinism 5× Proof (P2)

```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
node -e 'const f=async()=>{const r=await fetch("http://localhost:3500/v1/run?seed=1337"); const j=await r.json(); console.log(j.model_card?.response_hash)}; (async()=>{for(let i=0;i<5;i++) await f()})()'
kill %1
```

**Expected**: Same hash printed 5 times

---

## 💾 Gate E: Limits Caching (P3)

```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
ETAG=$(curl -sD - http://localhost:3500/v1/limits -o /dev/null | awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" http://localhost:3500/v1/limits
kill %1
```

**Expected**: `304`

---

## ⚠️ Gate F: Error Envelope Samples (P1)

### F1: Limit Exceeded
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
curl -s "http://localhost:3500/v1/run?nodes=9999" | jq '.schema,.code,.fields'
kill %1
```

**Expected**:
```json
{
  "schema": "error.v1",
  "code": "LIMIT_EXCEEDED",
  "fields": {
    "field": "graph.nodes",
    "max": 12
  }
}
```

### F2: Rate Limited
```bash
PORT=3501 RATE_LIMIT_ENABLED=1 RATE_LIMIT_MAX=2 AUTH_ENABLED=0 node dist/main.js &
sleep 2
for i in 1 2 3; do curl -s "http://localhost:3501/v1/run"; done | tail -1 | jq '.schema,.code,.retry_after'
curl -i "http://localhost:3501/v1/run" | grep -E "Retry-After|X-RateLimit-Reset"
kill %1
```

**Expected**:
```json
{
  "schema": "error.v1",
  "code": "RATE_LIMITED",
  "retry_after": 1-60
}
```
**Headers**: `Retry-After: <seconds>`, `X-RateLimit-Reset: <timestamp>` (optional)

---

## 📚 Gate G: Schemas & OpenAPI (T2)

```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2
curl -sI http://localhost:3500/openapi.json | head -1
curl -sI http://localhost:3500/schemas/error.v1.json | head -1
kill %1
```

**Expected**: `HTTP/1.1 200 OK` for both

---

## 📝 PR Body Requirements

### All PRs (Except P1)
```markdown
## Known Status
This PR does not add failures; a small, pre-existing set from A2 taxonomy is tracked in issue #NNN.

## Baseline Artifacts
See `BASELINE-20251023-012747.md` and `TEST-20251023-012747.log`.

## Proofs
[Paste outputs from gates C/D/E as applicable]

## Rollback
Single-commit revert, no data migration.

## Security
No secrets in logs; tokens redacted; headers enforced.
```

### P1 (Error Envelope) Only
```markdown
## Known Status
This PR updates contract to error.v1. Tests that referenced legacy codes were updated; CI must be fully green.

## Proofs
[Paste outputs from gate F]

## Rollback
Single-commit revert, no data migration.

## Security
No secrets in logs; tokens redacted; headers enforced.
```

---

## ✅ Reviewer Checklist (Paste in Each PR)

```markdown
## Reviewer Checklist

- [ ] CI: build passes, test delta vs baseline = 0 (or fully green for P1)
- [ ] No stray changes (diff limited to declared scope)
- [ ] Evidence: proofs pasted and reproducible
- [ ] No PII/log leaks; bounded metrics labels
- [ ] Rollback path verified (`git revert <sha>` is clean)
- [ ] Security headers enforced (SSE)
- [ ] Tokens redacted in logs/metrics
- [ ] No `.only` in tests
- [ ] TypeScript errors: 0
- [ ] No `src/*.js` tracked
```

---

## 🚦 CI Protection (Branch Protection)

Add these required checks:

```yaml
# .github/workflows/ci.yml
- name: Build
  run: npm ci && npm run build

- name: Test
  run: npx vitest run

- name: Lint & Typecheck
  run: npm run lint && npm run typecheck

- name: Guard .only in tests
  run: '! git grep -nE "\.only\(" -- "tests/**/*.test.*"'
```

---

## 🔧 P1 Path to Green (Action Items)

### Update Failing Tests
1. Map legacy codes to error.v1:
   - `TIMEOUT|RETRYABLE|INTERNAL` → `SERVER_ERROR`
   - `RATE_LIMIT` → `RATE_LIMITED`
   - `BLOCKED_CONTENT` → `BAD_INPUT`

2. Update assertions:
   - `schema: "error.v1"`
   - `retry_after` only for `RATE_LIMITED`
   - `fields: {field, max}` only for `LIMIT_EXCEEDED`

3. Ensure `replyWithError()` sets:
   - `Retry-After` header (for rate limits)
   - `X-RateLimit-Reset` header (optional)

4. Rerun full suite: target 0 new failures

### Alternative: Split P1
- **Part A**: Types + helpers (no call-site changes, tests added)
- **Part B**: Migration (update code + tests)

---

## 🎯 P4 Wiring (Part-2) Acceptance

After T1 integration, verify:
- [ ] `retry: 1500` first line
- [ ] `:keepalive` ~15s
- [ ] Monotonic integer `id:`
- [ ] `Last-Event-ID` → one `resume_unavailable` then normal flow
- [ ] Security headers present
- [ ] No 3xx on `/v1/stream`
- [ ] Tokens redacted in logs/metrics

**Run integration tests**:
```bash
npx vitest run tests/p4-sse-hygiene.int.test.ts
```

---

## 📖 T2 Schemas Acceptance

- [ ] `/openapi.json` returns 200 with error.v1, report.v1, limits.v1, stream.event.*.v1
- [ ] `/schemas/*.json` accessible
- [ ] AJV validation on fixtures is green
- [ ] 3 fixtures: `report-success.v1.json`, `error-bad-input-with-fields.v1.json`, `error-limit-exceeded-nodes.v1.json`
- [ ] CI job `test:schemas` validates fixtures

**Run schema tests**:
```bash
npx vitest run tests/schemas.validate.test.ts
```

---

## 🚀 Post-Merge Smoke (Staging)

```bash
STAGE="https://staging.example.com"

# Stream (no redirect, headers, retry, beats)
curl -s -D - -N "$STAGE/v1/stream?demo=1" | head -n 40

# Determinism 5×
for i in {1..5}; do curl -s "$STAGE/v1/run?seed=1337" | jq -r .model_card.response_hash; done | sort | uniq -c

# Limits 200→304
E=$(curl -sD - "$STAGE/v1/limits" -o /dev/null | awk -F': ' '/^ETag:/{print $2}')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $E" "$STAGE/v1/limits"
```

---

## ⚠️ Risk & Rollback

**P1** is the only contract-touching PR:
- Keep it separate and green
- Update all legacy code assertions
- Target: 0 new failures

**P4 Part-1** (utilities):
- Safe, no endpoint changes
- Can merge immediately

**P4 Part-2** (wiring):
- Can be reverted independently
- No data migration

**Rollback**: `git revert <sha>` for any PR

---

**Status**: ✅ Gates defined, ready to validate each branch  
**Next**: Run gates on each PR branch before opening
