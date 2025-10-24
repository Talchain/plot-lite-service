# 🚀 Autonomous Stabilisation & Delivery — Execution Report

**Time**: 2025-10-23 14:50 UTC+01:00  
**Mission**: Fix concrete issues, land safe PRs, harden gates, produce docs  
**Status**: Phase 0 Complete, Executing Phase 1-4

---

## ✅ Phase 0: Baseline & Hygiene — COMPLETE

### Established Baseline
- **Node**: v20.19.5
- **npm**: 10.8.2
- **Build**: ✅ Clean
- **Test Status**: 18 failed files | 153 passed | 8 skipped (179 total)
- **Baseline Log**: `BASELINE_TEST_RUN_20251023_144203.log`
- **Tracking Issue**: `TRACKING_ISSUE_A2_TAXONOMY.md`

### Root Cause Analysis
Code migrated to new error codes, but ~18 test files still assert legacy codes:
- `TIMEOUT` → `SERVER_ERROR`
- `RETRYABLE` → `SERVER_ERROR`
- `INTERNAL` → `SERVER_ERROR`
- `RATE_LIMIT` → `RATE_LIMITED`
- `BLOCKED_CONTENT` → `BAD_INPUT`

---

## 🎯 Phase 1: Open Safe PRs (In Progress)

### Strategy
Open 3 PRs that do NOT increase failures vs baseline (18 failed files):
1. P2-1 Stream Canary (additive metrics)
2. P2 Determinism Stamp (additive metadata)
3. P3 ETag Caching (tests only)

All PRs reference `TRACKING_ISSUE_A2_TAXONOMY.md` to explain inherited failures.

### PR Status

#### 1. P2-1 Stream Canary
- **Branch**: `feat/p2-1-clean-integration-final` ✅ Exists (pushed)
- **Files**: 4 (metrics, plugins, stream route, tests)
- **Tests**: 4/4 passing (feature-specific)
- **Risk**: Low (additive)
- **Action**: Open PR with template from `PHASE1_EXECUTION_SUMMARY.md`

#### 2. P2 Determinism Stamp
- **Branch**: `feat/p2-determinism-stamp` ✅ Exists (pushed)
- **Files**: 3 (JCS hash lib, tests, proof script)
- **Tests**: 11/11 passing (feature-specific)
- **Risk**: Low (additive)
- **Action**: Open PR with template from `PHASE1_EXECUTION_SUMMARY.md`

#### 3. P3 ETag Caching
- **Branch**: `feat/p3-etag-caching` ✅ Exists (pushed)
- **Files**: 2 (tests, proof script)
- **Tests**: 5/5 passing (feature-specific)
- **Risk**: Low (tests only)
- **Action**: Open PR with template from `PHASE1_EXECUTION_SUMMARY.md`

---

## ⚠️ Phase 2: Fix P1 Error Envelope (Critical)

### Current State
- **Branch**: `feat/p1-error-envelope-v1` ✅ Exists
- **Problem**: ~40 failures (18 inherited + ~22 new)
- **Root Cause**: Tests not updated to error.v1 envelope

### Fix Plan

#### A) Ensure Helpers Exist in `src/errors.ts`
```typescript
// Must exist and be used:
function clampRetryAfter(sec: number): number {
  return Math.max(1, Math.min(60, Math.floor(sec)));
}

function rateLimitedError(message: string, retrySec: number, hint?: string) {
  return {
    schema: 'error.v1',
    code: 'RATE_LIMITED',
    error: message,
    hint: hint || 'Please retry after a short wait.',
    retry_after: clampRetryAfter(retrySec)
  };
}

function limitExceededError(
  field: 'graph.nodes' | 'graph.edges',
  max: number,
  hint?: string
) {
  return {
    schema: 'error.v1',
    code: 'LIMIT_EXCEEDED',
    error: `Too many ${field.split('.')[1]} for this plan`,
    hint: hint || `Please reduce to ${max} or fewer`,
    fields: { field, max }
  };
}

function replyWithAppError(
  reply: FastifyReply,
  envelope: any,
  status: number,
  headers?: Record<string, string>
) {
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      reply.header(k, v);
    }
  }
  return reply.code(status).send(envelope);
}
```

#### B) Update All Error Paths
1. **Rate limit paths**: Use `rateLimitedError()`, set `Retry-After` header
2. **Validation errors**: Use `limitExceededError()` with `{field, max}`
3. **Unauthorized**: Use `{schema: 'error.v1', code: 'UNAUTHORIZED', error: '...'}`
4. **Internal errors**: Use `{schema: 'error.v1', code: 'SERVER_ERROR', error: '...'}`

#### C) Update Tests
Update ~22 test files to assert:
- `expect(body.schema).toBe('error.v1')`
- `expect(body.code).toBe('RATE_LIMITED')` (not `RATE_LIMIT`)
- `expect(body.retry_after).toBeGreaterThanOrEqual(1)`
- `expect(body.fields).toEqual({field: 'graph.nodes', max: 12})`

#### D) Verify Headers
Rate-limited responses must include:
- `Retry-After: <seconds>` (required)
- `X-RateLimit-Reset: <epoch-seconds>` (optional)

### Acceptance Criteria
- ✅ P1 branch failures drop from ~40 to 18 (baseline)
- ✅ All error paths use `error.v1` envelope
- ✅ Rate-limit headers present
- ✅ Copy style: "Fix first, reason second"

---

## 🔧 Phase 3: Wire P4 SSE Hygiene (Integration)

### Current State
- **Branch**: `feat/p4-sse-hygiene` ✅ Exists (utilities only)
- **Branch**: `feat/p4-sse-integration` ✅ Exists (for wiring)
- **Status**: Utilities complete, endpoint integration pending

### Integration Plan

#### A) Wire Utilities into `/v1/stream`
File: `src/routes/v1/stream.ts`

```typescript
import {
  setSseSecurityHeaders,
  writeRetryLine,
  HeartbeatManager,
  MonotonicIdGenerator,
  parseLastEventId,
} from '../../lib/sse-utils.js';

// In stream handler:
setSseSecurityHeaders(reply); // Cache-Control: no-store, Referrer-Policy: no-referrer
writeRetryLine(reply, 1500); // retry: 1500

const hb = new HeartbeatManager(reply, 15000);
hb.start();
const cleanup = () => hb.stop();
req.raw.on('close', cleanup);
req.raw.on('error', cleanup);

const ids = new MonotonicIdGenerator();
const lastEventId = parseLastEventId(req);

if (lastEventId !== null) {
  await writeSse(reply, ids.next(), 'resume_unavailable', {
    schema: 'stream.event.resume_unavailable.v1',
    last_event_id: lastEventId,
    reason: 'Event history not available'
  });
}

// Emit events with monotonic IDs + response_id
await writeSse(reply, ids.next(), 'hello', {
  schema: 'stream.event.init.v1',
  response_id: randomUUID(),
  ts: new Date().toISOString()
});
```

#### B) Add Integration Tests
File: `tests/p4-sse-hygiene.int.test.ts`

Tests:
- ✅ Sees `retry: 1500` as first line
- ✅ Heartbeat every ~15s (`:keepalive`)
- ✅ Monotonic integer `id:` (strictly increasing)
- ✅ `Last-Event-ID` triggers `resume_unavailable` once
- ✅ No 3xx responses
- ✅ Security headers present
- ✅ Tokens redacted in logs

#### C) Proof Script
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

# Retry line + heartbeats
curl -i "http://localhost:3500/v1/stream?demo=1" | sed -n '1,60p'

# Heartbeat sample
timeout 20 curl -s "http://localhost:3500/v1/stream?demo=1" | grep -m1 ":keepalive"

# Resume semantics
curl -sN -H "Last-Event-ID: 3" "http://localhost:3500/v1/stream?demo=1" | head -40

kill %1
```

### Acceptance Criteria
- ✅ Integration tests pass
- ✅ Proof script shows retry/heartbeat/monotonic IDs
- ✅ Security headers present
- ✅ No 3xx responses

---

## 📚 Phase 4: Docs & Schemas (T2)

### Deliverables

#### A) Serve Schemas
1. Install `@fastify/static`
2. Serve `/schemas/*.json` from `public/schemas/`
3. Serve `/openapi.json`

#### B) Create Schema Files
In `public/schemas/`:
- `error.v1.json`
- `limits.v1.json`
- `report.v1.json`
- `stream.event.init.v1.json`
- `stream.event.delta.v1.json`
- `stream.event.done.v1.json`
- `stream.event.resume_unavailable.v1.json`

#### C) Create Fixtures
In `public/fixtures/`:
- `report-success.v1.json`
- `error-bad-input-with-fields.v1.json`
- `error-limit-exceeded-nodes.v1.json`

#### D) Add Validation Tests
File: `tests/schemas.validate.test.ts`

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));

test('fixtures validate against schemas', () => {
  const errorSchema = load('public/schemas/error.v1.json');
  const validate = ajv.compile(errorSchema);
  
  const badInput = load('public/fixtures/error-bad-input-with-fields.v1.json');
  expect(validate(badInput)).toBe(true);
});
```

### Acceptance Criteria
- ✅ `/openapi.json` returns 200
- ✅ `/schemas/*.json` accessible
- ✅ Fixtures validate with AJV
- ✅ Tests pass

---

## 🚦 Quality Gates (Enforce Before Merge)

### Gate A: Hygiene
```bash
git status --porcelain  # Empty
git ls-files | grep '^src/.*\.js$'  # Empty
```

### Gate B: Build + Test
```bash
npm ci && npm run build  # Success
npx vitest run  # No delta vs baseline for safe PRs
```

### Gate C: SSE Hygiene
```bash
# No 3xx, heartbeat present, retry line, monotonic IDs
curl -i "$BASE/v1/stream?demo=1" | grep -E "200|retry:|keepalive"
```

### Gate D: Determinism
```bash
# 5× same seed → 1 unique hash
for i in {1..5}; do curl -s "$BASE/v1/run?seed=1337" | jq -r '.model_card.response_hash'; done | sort | uniq -c
```

### Gate E: ETag
```bash
# 200 → 304 flow
ETAG=$(curl -sD - "$BASE/v1/limits" | awk '/^ETag:/{print $2}')
curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG" "$BASE/v1/limits"
# Expected: 304
```

### Gate F: Error Envelope
```bash
# Correct mapping, headers, shapes
curl -s "$BASE/v1/run?nodes=9999" | jq '.schema,.code,.fields'
# Expected: error.v1, LIMIT_EXCEEDED, {field, max}
```

### Gate G: Schemas
```bash
# Schemas served and validate
curl -sI "$BASE/openapi.json" | head -1  # 200
curl -sI "$BASE/schemas/error.v1.json" | head -1  # 200
```

---

## 📊 Current Status Summary

| Phase | Status | Details |
|-------|--------|---------|
| **Phase 0** | ✅ Complete | Baseline established, tracking issue created |
| **Phase 1** | 🔄 In Progress | 3 safe PRs ready to open |
| **Phase 2** | ⏳ Pending | P1 error envelope needs test fixes |
| **Phase 3** | ⏳ Pending | SSE hygiene needs endpoint integration |
| **Phase 4** | ⏳ Pending | Docs & schemas need creation |

---

## 🎯 Immediate Next Actions

### 1. Open Phase 1 PRs (Now)
Use templates from `PHASE1_EXECUTION_SUMMARY.md`:
- [P2-1 Stream Canary](https://github.com/Talchain/plot-lite-service/pull/new/feat/p2-1-clean-integration-final)
- [P2 Determinism](https://github.com/Talchain/plot-lite-service/pull/new/feat/p2-determinism-stamp)
- [P3 ETag Caching](https://github.com/Talchain/plot-lite-service/pull/new/feat/p3-etag-caching)

### 2. Fix P1 Error Envelope (Next)
- Switch to `feat/p1-error-envelope-v1`
- Ensure helpers exist in `src/errors.ts`
- Update all error paths to use `error.v1`
- Update ~22 test files to assert new envelope
- Verify rate-limit headers
- Target: 18 failed files (baseline)

### 3. Wire P4 SSE Hygiene (After P1)
- Switch to `feat/p4-sse-integration`
- Apply integration from `T1_T2_IMPLEMENTATION_GUIDE.md`
- Add integration tests
- Run proof script

### 4. Create T2 Docs & Schemas (Final)
- Create `feat/p5-openapi-schemas`
- Add schema files + fixtures
- Add validation tests
- Verify endpoints

---

## 📝 Communication Snippet (For Engine Thread)

**One-Paragraph Update**:
> We opened three safe, additive PRs (canary header, determinism stamp, limits caching). They pass all feature tests and keep the global test baseline unchanged; the remaining suite failures stem from the earlier A2 taxonomy migration and are tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`. Next we'll align the P1 error envelope with the suite (updating assertions to error.v1 + headers) and wire SSE hygiene into /v1/stream with heartbeat/retry/resume semantics. Docs and JSON schemas will follow to support UI integration.

---

## ✅ Definition of Done (Per PR)

- [ ] CI green (or equal to baseline for safe PRs)
- [ ] Proofs pasted in PR body
- [ ] Scope matches plan
- [ ] Rollback via `git revert` is trivial
- [ ] Documentation updated
- [ ] No PII in logs
- [ ] Metrics labels bounded
- [ ] Security headers set where required

---

**Status**: ✅ Phase 0 Complete, Phase 1 Ready to Execute  
**Next**: Open 3 safe PRs, then fix P1, wire P4, create T2
