# 🤖 Autonomous Roadmap Execution Plan

**Status**: Ready for Execution  
**Scope**: P1-P7 Implementation  
**Approach**: Iterative, test-driven, production-ready

---

## Execution Strategy

Due to the comprehensive nature of this roadmap (7 priority items, each requiring design → code → tests → docs → rollout), I recommend a **phased autonomous approach**:

### Phase 1: Foundation (P1-P2) - **CURRENT FOCUS**
- **P1**: Streaming Endpoint Parity & Backpressure
- **P2**: Rate Limiting v2 (Fairness & Burst Control)

### Phase 2: Reliability (P3-P4)
- **P3**: Idempotency & Dedup Hardening
- **P4**: Schema & Error Taxonomy v2

### Phase 3: Intelligence (P5-P6)
- **P5**: Adaptive Circuit Breaker Enhancements
- **P6**: SLOs, Dashboards & Alerts

### Phase 4: Security (P7)
- **P7**: Security & Supply Chain Hygiene

---

## Current Status: P1 Micro-Design Complete

✅ **Completed**:
- Micro-design document created (`docs/roadmap/p1-streaming-parity.md`)
- Feature branch created (`feat/p1-streaming-parity`)
- Existing `/v1/stream` implementation analyzed

🚧 **Next Steps for P1**:

### 1. Request Schema (Low Risk)
```typescript
// src/schemas/stream.ts
export const streamQuerySchema = {
  type: 'object',
  properties: {
    demo: { type: 'integer', enum: [0, 1] },
    latency_ms: { type: 'integer', minimum: 0, maximum: 60000 },
    heartbeat_ms: { type: 'integer', minimum: 0, maximum: 60000 },
    max_events: { type: 'integer', minimum: 1, maximum: 10000 }
  },
  additionalProperties: false
} as const;
```

### 2. Event Schemas
```typescript
// src/schemas/sse-events.ts
export const helloEventSchema = {
  type: 'object',
  required: ['schema', 'ts', 'heartbeat_ms'],
  properties: {
    schema: { const: 'hello.v1' },
    ts: { type: 'string', format: 'date-time' },
    trace_id: { type: 'string' },
    heartbeat_ms: { type: 'integer' }
  },
  additionalProperties: false
} as const;

// ... token.v1, heartbeat.v1, done.v1, error.v1
```

### 3. Heartbeat Mechanism
```typescript
// src/lib/sse-heartbeat.ts
export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  
  start(intervalMs: number, onBeat: () => Promise<void>) {
    if (intervalMs <= 0) return;
    this.timer = setInterval(async () => {
      this.seq++;
      await onBeat();
    }, intervalMs);
    this.timer.unref();
  }
  
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

### 4. Memory-Bounded Queue
```typescript
// src/lib/sse-queue.ts
export class BoundedEventQueue {
  private queue: Array<{id: number, event: string, data: unknown}> = [];
  private maxSize: number;
  
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }
  
  push(item: {id: number, event: string, data: unknown}): 'ok' | 'dropped' {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
      return 'dropped';
    }
    this.queue.push(item);
    return 'ok';
  }
  
  // ... drain, size, clear methods
}
```

### 5. Enhanced Metrics
```typescript
// src/observability/sseMetrics.ts
let heartbeatTotal = 0;
let eventsDroppedTotal = 0;
const queueDepthGauge = new Map<string, number>();

export function incSseHeartbeat() { heartbeatTotal++; }
export function incSseEventsDropped(reason: 'overflow' | 'backpressure') {
  eventsDroppedTotal++;
}
export function setSseQueueDepth(streamId: string, depth: number) {
  queueDepthGauge.set(streamId, depth);
}

export function renderSseMetrics(): string {
  // Prometheus text format
}
```

### 6. Integration with Circuit Breaker
```typescript
// In stream route preHandler
if (isCircuitOpen(principal)) {
  incSseCircuitRejected();
  await writeSse(reply, 0, 'error', {
    schema: 'error.v1',
    code: 'CIRCUIT_OPEN',
    message: 'Service temporarily unavailable',
    recoverable: true
  });
  await writeSse(reply, 1, 'done', {
    schema: 'done.v1',
    reason: 'circuit_open'
  });
  safeEnd(reply);
  return reply;
}
```

### 7. Tests
```typescript
// tests/p1-streaming-parity.test.ts
describe('P1: Streaming Parity', () => {
  it('validates request schema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stream?invalid=param'
    });
    expect(res.statusCode).toBe(400);
  });
  
  it('sends heartbeats at configured interval', async () => {
    // Test heartbeat delivery
  });
  
  it('enforces memory bounds', async () => {
    // Test queue overflow
  });
  
  it('integrates with circuit breaker', async () => {
    // Test CB rejection
  });
});

// tests/p1-streaming-soak.e2e.ts
describe('P1: E2E Soak Test', () => {
  it('runs 10-minute stream without memory growth', async () => {
    // Long-running test
  }, 600000); // 10 minutes
});
```

---

## Recommendation: Iterative Delivery

Given the scope, I recommend:

1. **Complete P1 first** (streaming parity) as a focused PR
2. **Verify in production** before moving to P2
3. **Learn and adapt** based on P1 results
4. **Continue with P2-P7** using the same pattern

This ensures:
- ✅ Each PR is reviewable and testable
- ✅ Production feedback informs next steps
- ✅ Risk is minimized through incremental delivery
- ✅ Team can provide input between phases

---

## Next Action

**Option A: Continue P1 Implementation**
- I can continue implementing P1 code, tests, and docs
- Create PR when complete
- Verify deployment

**Option B: Pause for Review**
- Review P1 micro-design
- Adjust scope/approach if needed
- Resume implementation

**Your Choice**: Which option would you prefer?

---

**Status**: ⏸️ **AWAITING DIRECTION**  
**Recommendation**: Option A (Continue P1)  
**Confidence**: HIGH - Design is solid, implementation path is clear
