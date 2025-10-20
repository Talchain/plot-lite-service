# Strict Inflight Accounting - No Clamping, Underflow Detection

## ✅ Status: COMPLETE - All Gates Pass

**Final Gate Output:**
```
GATES: PASS — inflight balanced after 100 SSE cycles (underflows=0)
```

---

## 🎯 Problem Solved

**Hidden bug class**: Silent underflows caused by:
1. **Clamping** with `Math.max(0, counter - 1)` masked double-decrements
2. **Double-decrement** risk when both `endStream()` and `onResponse` called `dec()`
3. **No visibility** into underflows → regressions slip through

**Solution**: Strict, auditable accounting that **fails fast** on bugs instead of hiding them.

---

## 📊 Changes Summary

### A) **Strict Accounting** (`src/runtime/inflight.ts`)

**Before (clamped):**
```typescript
dec(): void {
  counter = Math.max(0, counter - 1); // ❌ Masks bugs
}
```

**After (strict):**
```typescript
dec(source: InflightSource = 'onResponse'): number {
  if (count <= 0) {
    underflows += 1;
    const msg = `INFLIGHT UNDERFLOW: dec from ${source} while count=${count}`;
    
    // Test contexts: fail fast
    if (process.env.TEST_ROUTES === '1' || process.env.NODE_ENV === 'test') {
      throw new Error(msg);
    } else {
      // Production: log loudly but don't crash
      console.error(msg);
    }
    return count;
  }
  
  count -= 1;
  return count;
}
```

**Key changes:**
- ✅ No clamping - underflows are bugs, not silenced
- ✅ Source tracking (`onRequest`, `onResponse`, `endStream`, `error`)
- ✅ Throws in tests - fail fast on regressions
- ✅ Logs in prod - visible in Evidence Pack
- ✅ Stats tracking - `{ count, underflows }` for auditing

### B) **Double-Decrement Guard** (`src/main.ts`, `src/createServer.ts`)

**Hook guard in `main.ts`:**
```typescript
app.addHook('onResponse', async (req, reply) => {
  const url = (req as any).url || '';
  if (url.startsWith('/test/inflight')) return; // Exclude probes
  
  // Guard against double-decrement
  if ((reply.raw as any).__inflightDecDone) return;
  
  app.inflight.dec('onResponse');
});
```

**SSE endStream guard in `createServer.ts`:**
```typescript
const endStream = () => {
  if (closed) return; // Idempotent: prevent double-decrement
  closed = true;
  
  // Mark as decremented to prevent onResponse from also decrementing
  (reply.raw as any).__inflightDecDone = true;
  
  app.inflight.dec('endStream');
  try { reply.raw.end(); } catch {}
};
```

**Guarantee**: Exactly one inc, one dec per request:
- Non-SSE: `onRequest inc` → `onResponse dec`
- SSE: `onRequest inc` → `endStream dec` (onResponse skipped)

### C) **Stats Probe** (`src/createServer.ts`)

**New endpoint (TEST_ROUTES only):**
```typescript
app.get('/test/inflight_stats', async (req, reply) => {
  if (req.headers['x-test-auth'] !== '1') {
    return reply.code(403).send({ error: 'forbidden' });
  }
  reply.header('Content-Type', 'application/json; charset=utf-8');
  return app.inflight.stats(); // { count, underflows }
});
```

**Usage:**
```bash
$ curl -H "X-Test-Auth: 1" http://localhost:4311/test/inflight_stats
{"count":0,"underflows":0}
```

### D) **Updated Types** (`src/types/fastify.d.ts`)

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    inflight: {
      inc(): number;
      dec(source?: 'onRequest' | 'onResponse' | 'endStream' | 'error'): number;
      count(): number;
      stats(): { count: number; underflows: number };
    };
  }
}
```

### E) **Enhanced Tests** (`tests/stream.disconnect.test.ts`)

**New assertions:**
```typescript
// Verify NO underflows occurred (strict accounting)
const stats = await getInflightStats(BASE);
expect(stats.count).toBe(0);
expect(stats.underflows).toBe(0);
```

**New test:**
```typescript
it('P0: probe endpoint does not count itself', async () => {
  const first = await getInflight(BASE);
  const second = await getInflight(BASE);
  expect(second).toBe(first); // Probe doesn't affect inflight
});
```

### F) **CI Gate** (`tools/sse-inflight-gate.mjs`)

**Enhanced checks:**
```javascript
// Check final inflight and underflows
const final = await getInflight();
const stats = await getInflightStats();

// Check for inflight imbalance
if (final !== 0) {
  console.error(`GATES: FAIL — inflight=${final} after ${CYCLES} SSE cycles (expected 0)`);
  process.exit(1);
}

// Check for underflows (strict accounting)
if (stats && stats.underflows > 0) {
  console.error(`GATES: FAIL — underflows=${stats.underflows} detected during ${CYCLES} SSE cycles`);
  process.exit(1);
}

console.log(`GATES: PASS — inflight balanced after ${CYCLES} SSE cycles (underflows=0)`);
```

---

## 🔍 Verification Results

### **1. Strict Accounting** ✅
```bash
$ grep -n "Math.max" src/runtime/inflight.ts
✅ No clamping found in inflight.ts
```

### **2. Double-Decrement Guard** ✅
- **endStream** sets `__inflightDecDone` flag
- **onResponse** checks flag before decrementing
- Both SSE routes (TEST_ROUTES and FEATURE_STREAM) updated

### **3. Probe Endpoints** ✅
```bash
# With auth
$ curl -H "X-Test-Auth: 1" http://localhost:4311/test/inflight_stats
{"count":0,"underflows":0}

# Without auth
$ curl http://localhost:4311/test/inflight_stats
{"error":"forbidden"}
```

### **4. Balance Invariant** ✅
```
Initial: 0
20/100: 0
40/100: 0
60/100: 0
80/100: 0
100/100: 0
Final: 0
```

### **5. Underflow Invariant** ✅
```
📋 Summary:
  - Cycles: 100
  - Initial inflight: 0
  - Final inflight: 0
  - Underflows: 0 ✅
```

### **6. No Side-Effect Imports** ✅
```bash
$ grep -r "import('./main.js')" src/
✅ No side-effect imports found
```

---

## 🎯 Trust Signal

**Inflight is now a trust signal:**
- ❌ **Before**: Clamping masked bugs → false confidence
- ✅ **After**: Underflows detected → provable correctness

**In tests**: Underflow throws → CI catches regressions  
**In prod**: Underflow logs → Evidence Pack surfaces issues  

---

## 📝 File Changes

| File | Changes | Status |
|------|---------|--------|
| `src/runtime/inflight.ts` | Removed clamping, added underflow detection | ✅ |
| `src/types/fastify.d.ts` | Added source param, stats method | ✅ |
| `src/createServer.ts` | Added stats probe, updated endStream guards | ✅ |
| `src/main.ts` | Added double-dec guard in onResponse hook | ✅ |
| `tests/stream.disconnect.test.ts` | Added underflow checks, probe self-test | ✅ |
| `tools/sse-inflight-gate.mjs` | Added underflow check, updated messages | ✅ |

**Total**: 6 files modified, 0 files created

---

## 🚀 Run Commands

```bash
# Build
npm run build

# Start server
PORT=4311 FEATURE_STREAM=1 TEST_ROUTES=1 node dist/main.js &

# Wait for server
sleep 2

# Run gate
node tools/sse-inflight-gate.mjs

# Expected output:
# GATES: PASS — inflight balanced after 100 SSE cycles (underflows=0)

# Cleanup
kill %1
```

---

## ✅ Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Strict accounting** | ✅ | No clamping, throws in tests |
| **Double-dec guard** | ✅ | `__inflightDecDone` flag set |
| **Probe availability** | ✅ | 200 with auth, 403 without, 404 no TEST_ROUTES |
| **Balance invariant** | ✅ | 0→1→0 for all paths, 100 cycles = 0 |
| **Underflow invariant** | ✅ | underflows=0 after 100 cycles |
| **No side-effects** | ✅ | Zero import('./main.js') found |
| **Gate message** | ✅ | Exact: `GATES: PASS — inflight balanced after 100 SSE cycles (underflows=0)` |

---

## 🎉 Key Improvements

### **1. Fail Fast on Bugs**
```typescript
// Test context: throw immediately
if (process.env.TEST_ROUTES === '1') {
  throw new Error(`INFLIGHT UNDERFLOW: dec from ${source}`);
}
```

### **2. Production Visibility**
```typescript
// Prod context: log loudly for Evidence Pack
console.error(`INFLIGHT UNDERFLOW: dec from ${source} while count=${count}`);
```

### **3. Source Tracking**
```typescript
app.inflight.dec('endStream');  // SSE cleanup
app.inflight.dec('onResponse'); // Normal request
app.inflight.dec('error');      // Error path
```

### **4. Auditable Stats**
```bash
$ curl -H "X-Test-Auth: 1" http://localhost:4311/test/inflight_stats
{
  "count": 0,        # Current inflight
  "underflows": 0    # Total underflows detected
}
```

---

## 🔒 Guarantees

### **Exactly One Inc, One Dec**
- Global `onRequest`: increments (skip probes)
- Global `onResponse`: decrements (skip if `__inflightDecDone`)
- SSE `endStream`: sets flag + decrements

### **Idempotency**
```typescript
if (closed) return; // Prevent double-dec
closed = true;
(reply.raw as any).__inflightDecDone = true;
app.inflight.dec('endStream');
```

### **No Silent Failures**
- Test: throws Error
- Prod: logs to console.error
- Stats: `underflows` counter

---

## 📚 Documentation

**Added comments:**
- `inflight.ts`: "No clamping. Underflow indicates a bug; throw in tests, log in prod."
- `main.ts`: "Guard against double-decrement: SSE routes set this flag in endStream()"
- `createServer.ts`: "Mark as decremented to prevent onResponse from also decrementing"

**No clamping gate** (optional but recommended):
```bash
# Add to CI to enforce no clamping
grep -q "Math.max.*counter" src/runtime/inflight.ts && \
  echo "FAIL: Clamping detected in inflight.ts" && exit 1
```

---

## 🎯 Summary

**Problem**: Clamping masked double-decrements → false zeros → regressions

**Solution**: Strict accounting + underflow detection + double-dec guard

**Result**:
```
✅ All 100 SSE cycles balanced
✅ No underflows (strict accounting)
✅ GATES: PASS — inflight balanced after 100 SSE cycles (underflows=0)
```

**Inflight is now a trust signal that proves correctness.**

---

**British English**: All user-facing messages maintain British spelling where applicable.

**Ready for**: Merge and CI verification.
