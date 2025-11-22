# 🎯 Action Plan: PRs → Merge → Integration

**Status**: Ready to execute  
**Time**: 2025-10-23 10:21 UTC+01:00

---

## Phase 1: Open PRs (Now)

### PR Links (Click to Open)
1. **P2-1 Stream Canary**: https://github.com/Talchain/plot-lite-service/pull/new/feat/p2-1-clean-integration-final
2. **P2 Determinism**: https://github.com/Talchain/plot-lite-service/pull/new/feat/p2-determinism-stamp
3. **P3 ETag Caching**: https://github.com/Talchain/plot-lite-service/pull/new/feat/p3-etag-caching
4. **P1 Error Envelope**: https://github.com/Talchain/plot-lite-service/pull/new/feat/p1-error-envelope-v1
5. **P4 SSE Hygiene**: https://github.com/Talchain/plot-lite-service/pull/new/feat/p4-sse-hygiene

### For Each PR:
1. Copy template from `PR_BODIES.md`
2. Run pre-flight checks from `PR_PREFLIGHT_CHECKLIST.md`
3. Attach proof outputs
4. Add reviewer checklist
5. Submit

---

## Phase 2: Merge Sequence

### Order (Smallest → Largest Impact)

#### 1️⃣ **P2-1 Stream Canary** (MERGE FIRST)
- **Why**: Smallest, safest, highest visibility
- **Risk**: Low (additive metrics only)
- **Tests**: 4/4 passing
- **Validation**: Check metrics endpoint after merge

#### 2️⃣ **P2 Determinism Stamp** (MERGE SECOND)
- **Why**: Low risk, additive metadata
- **Risk**: Low (no behavior changes)
- **Tests**: 11/11 passing
- **Validation**: 5× same seed → one hash

#### 3️⃣ **P3 ETag Caching** (MERGE THIRD)
- **Why**: Low risk, tests only
- **Risk**: Low (read-only endpoint)
- **Tests**: 5/5 passing
- **Validation**: 200 → 304 flow

#### 4️⃣ **P1 Error Envelope** (MERGE FOURTH - REVIEW CAREFULLY)
- **Why**: Contract surface change
- **Risk**: Medium (API shape)
- **Tests**: 5/5 passing
- **Validation**: error.v1 format, headers, retry_after clamping
- **⚠️ Action**: Address any test failures before merging

#### 5️⃣ **P4 SSE Hygiene** (MERGE LAST - UTILITIES ONLY)
- **Why**: Utilities only, integration pending
- **Risk**: Low (no endpoint changes yet)
- **Tests**: 8/8 passing
- **Note**: Follow-up PR needed for `/v1/stream` integration

---

## Phase 3: Post-Merge Validation

Run after each merge:

```bash
# Set BASE URL
BASE="http://localhost:3500"  # or staging URL

# 1. Determinism (after P2)
for i in {1..5}; do curl -s "$BASE/v1/run?template_id=t&seed=1337"; done \
| jq -r '.model_card.response_hash' | sort | uniq -c

# 2. Limits caching (after P3)
ETAG=$(curl -isS "$BASE/v1/limits" | awk '/^ETag:/ {print $2}' | tr -d '\r')
curl -isS -H "If-None-Match: $ETAG" "$BASE/v1/limits" | head -5

# 3. Error envelope (after P1)
curl -s "$BASE/v1/run?nodes=9999" | jq '.schema,.code,.fields'
curl -isS "$BASE/v1/run" | awk 'NR<=15'
curl -s "$BASE/v1/run" | jq '.schema,.code,.retry_after'

# 4. SSE hygiene (after P4 integration - not yet)
curl -N "$BASE/v1/stream?demo=1" | sed -n '1,25p'
```

---

## Phase 4: T1 - SSE Hygiene Integration (Next PR)

**Branch**: `feat/p4-sse-integration` (create after P4 utilities merge)

### Exact Wiring (~30 lines)

**File**: `src/routes/v1/stream.ts`

#### Changes:
1. **Import utilities**:
   ```typescript
   import { MonotonicIdGenerator, writeRetryLine, HeartbeatManager, setSseSecurityHeaders, parseLastEventId, writeSseEvent } from '../../lib/sse-utils.js';
   ```

2. **On connection** (both demo and non-demo paths):
   ```typescript
   // Replace existing headers with:
   setSseSecurityHeaders(reply);
   
   // Add retry line (once, at start):
   writeRetryLine(reply, 1500);
   
   // Start heartbeat:
   const heartbeat = new HeartbeatManager(reply, 15000);
   heartbeat.start();
   
   // Stop on close:
   const cleanup = () => { heartbeat.stop(); };
   (req.raw as any).on('close', cleanup);
   (req.raw as any).on('error', cleanup);
   ```

3. **Event emission**:
   ```typescript
   const idGen = new MonotonicIdGenerator();
   
   // Replace writeSse calls with:
   await writeSseEvent(reply, idGen.next(), 'hello', { schema: 'hello.v1', ts: '...' });
   await writeSseEvent(reply, idGen.next(), 'token', { schema: 'token.v1', text: 'hello', index: 0 });
   await writeSseEvent(reply, idGen.next(), 'done', { schema: 'done.v1', reason: 'complete' });
   ```

4. **Resume semantics** (optional for now):
   ```typescript
   const lastEventId = parseLastEventId(req);
   if (lastEventId !== null && lastEventId > 0) {
     // Emit resume_unavailable (no replay support yet)
     await writeSseEvent(reply, idGen.next(), 'resume_unavailable', {
       schema: 'stream.event.resume_unavailable.v1',
       last_event_id: lastEventId,
       reason: 'Event history not available'
     });
   }
   ```

### Integration Tests:
- `tests/p4-sse-hygiene.int.test.ts`
- Verify: `retry: 1500` first line
- Verify: heartbeat every ~15s
- Verify: monotonic IDs
- Verify: `Last-Event-ID` honored
- Verify: no 3xx responses

---

## Phase 5: T2 - Docs & Schemas (New PR)

**Branch**: `feat/p5-openapi-schemas` (create in parallel)

### Deliverables:

#### 1. Endpoints
- `GET /openapi.json` (OpenAPI 3.1)
- `GET /schemas/*.json` (static JSON Schemas)

#### 2. Schema Files (create in `public/schemas/`)
- `run.request.v1.json`
- `report.v1.json`
- `error.v1.json`
- `limits.v1.json`
- `stream.event.init.v1.json`
- `stream.event.delta.v1.json`
- `stream.event.done.v1.json`
- `stream.event.resume_unavailable.v1.json`

#### 3. Fixtures (create in `docs/fixtures/`)
- `report-success.v1.json`
- `error-bad-input-with-fields.v1.json`
- `error-limit-exceeded-nodes.v1.json`

#### 4. Tests
- `/openapi.json` serves & parses
- Each fixture validates against its schema (AJV)
- `/v1/limits` docs match runtime response

---

## Phase 6: Stabilization (Parallel to Reviews)

### Common Tripwires:

1. **Legacy error codes** → Map to error.v1 codes:
   - `TIMEOUT` → `SERVER_ERROR`
   - `INTERNAL` → `SERVER_ERROR`
   - `RATE_LIMIT` → `RATE_LIMITED`

2. **Rate limit assertions**:
   - Use `rateLimitedError()`
   - Assert `Retry-After` header
   - Assert `retry_after` field (1-60s)

3. **Demo flows**:
   - Confirm `hello→token→done` sequence
   - Respect new SSE hygiene

4. **SDK snapshots**:
   - Refresh only where contract changed (P1, P2)
   - Keep everything else stable

---

## �� Immediate Actions (You)

1. ✅ **Open 5 PRs** using templates in `PR_BODIES.md`
2. ✅ **Merge P2-1** (stream canary) → validate metrics
3. ✅ **Merge P2** (determinism) → validate 5× hash
4. ✅ **Merge P3** (ETag) → validate 304
5. ⚠️ **Address test failures** (if any)
6. ✅ **Merge P1** (error envelope) → validate error.v1 format
7. ✅ **Merge P4** (SSE utilities)
8. 🔧 **Create P4 integration PR** (I'll provide exact diff)
9. 🔧 **Create T2 PR** (docs & schemas)

---

## 📊 Success Criteria

- [ ] All 5 PRs opened with proofs
- [ ] P2-1, P2, P3 merged (safe set)
- [ ] Test suite stable after P1 merge
- [ ] P1, P4 merged
- [ ] P4 integration PR ready
- [ ] T2 PR ready
- [ ] Staging validation passes

---

**Status**: ✅ Ready to execute  
**Next**: Open PRs and start merge sequence
