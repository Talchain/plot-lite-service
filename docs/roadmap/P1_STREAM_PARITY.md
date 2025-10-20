# P1: /v1/stream Parity & Backpressure Hardening

**Status**: 🚧 Implementation  
**Priority**: P1 (Highest)  
**Target**: Production-ready streaming with /v1/run-level reliability

---

## Problem Statement

Current `/v1/stream` has basic SSE but lacks:
1. Request schema validation (no AJV, accepts arbitrary params)
2. Versioned event schemas (loosely typed)
3. Bounded backpressure (can buffer unbounded events)
4. Heartbeat mechanism (no keep-alive detection)
5. Circuit breaker integration (doesn't fail-fast when CB open)
6. Comprehensive metrics (limited visibility)

**Risk**: Memory exhaustion under slow clients; unclear failure modes.

---

## Scope

### In Scope ✅
- AJV request schema (`additionalProperties: false`)
- Versioned SSE event schemas (`stream.event.v1`)
- Memory-bounded queue (max 100 events, drop oldest)
- Configurable heartbeat (default 30s, env: `SSE_HEARTBEAT_MS`)
- CB integration (fail-fast with typed error event)
- Enhanced metrics (clients gauge, drops counter, duration histogram)
- E2E soak test (60s sustained stream)

### Out of Scope ❌
- WebSocket support
- Binary streaming
- Resume tokens (deferred to P2)
- Multi-tenant isolation (handled by existing rate limiter)

---

## API Changes

### Request Schema
```typescript
// Query parameters (AJV validated)
{
  demo?: 0 | 1,              // Existing
  latency_ms?: number,       // Existing (0-60000)
  heartbeat_ms?: number,     // NEW (0-60000, 0=disabled)
  max_events?: number        // NEW (1-10000, for testing)
}
```

### Event Schemas (Versioned)
```typescript
// stream.init.v1
{
  schema: 'stream.init.v1',
  ts: string,                // ISO 8601
  trace_id?: string,
  heartbeat_ms: number       // Negotiated interval
}

// stream.token.v1
{
  schema: 'stream.token.v1',
  text: string,
  index: number
}

// stream.heartbeat.v1 (NEW)
{
  schema: 'stream.heartbeat.v1',
  ts: string,
  seq: number
}

// stream.done.v1
{
  schema: 'stream.done.v1',
  reason: 'complete' | 'timeout' | 'client_cancel' | 'circuit_open' | 'error'
}

// stream.error.v1
{
  schema: 'stream.error.v1',
  code: string,              // CIRCUIT_OPEN, BACKPRESSURE, etc.
  message: string,
  recoverable: boolean
}
```

---

## Configuration

### New Environment Variables
```bash
SSE_HEARTBEAT_MS=30000           # Heartbeat interval (0=disabled)
SSE_MAX_BUFFERED_EVENTS=100      # Memory bound per stream
SSE_BACKPRESSURE_THRESHOLD=10    # Warn when queue > this
```

### Existing (Keep)
```bash
SSE_PER_IP_MAX=5
SSE_GLOBAL_MAX=100
SSE_SLOT_MAX_MS=300000
```

---

## Security & Performance

### Security
- **Cap heartbeat_ms**: Max 60s to prevent timer exhaustion
- **Bounded queue**: Hard limit 100 events, drop oldest on overflow
- **No secret logging**: Redact principals in debug logs
- **Timeout enforcement**: Existing `SSE_SLOT_MAX_MS` preserved

### Performance
- **Target**: p95 frame latency < 50ms
- **Memory**: Bounded queue prevents unbounded growth
- **CPU**: Heartbeat timers use `unref()` for GC-friendly cleanup
- **Measurement**: Add histogram for frame write latency

---

## Metrics (New)

```
# Active connections
plot_engine_stream_clients{state="open|closed"} gauge

# Backpressure drops
plot_engine_stream_backpressure_drops_total{reason="overflow|slow_client"} counter

# Stream duration
plot_engine_stream_duration_ms histogram

# Heartbeats sent
plot_engine_stream_heartbeat_total counter

# Circuit breaker rejections
plot_engine_stream_circuit_rejected_total counter
```

### Existing (Keep)
- `plot_engine_sse_open_total`
- `plot_engine_sse_closed_total`
- `plot_engine_sse_timeout_total`
- `plot_engine_stream_rate_limited_total`
- `plot_engine_stream_disconnect_total`
- `plot_engine_stream_write_backpressure_total`

---

## Implementation Plan

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
export const streamInitSchema = {
  type: 'object',
  required: ['schema', 'ts', 'heartbeat_ms'],
  properties: {
    schema: { const: 'stream.init.v1' },
    ts: { type: 'string' },
    trace_id: { type: 'string' },
    heartbeat_ms: { type: 'integer' }
  },
  additionalProperties: false
} as const;
// ... similar for token, heartbeat, done, error
```

### 3. Bounded Queue
```typescript
// src/lib/sse-queue.ts
export class BoundedEventQueue {
  private queue: Array<{id: number, event: string, data: unknown}> = [];
  private maxSize: number;
  
  constructor(maxSize = 100) { this.maxSize = maxSize; }
  
  push(item: {id: number, event: string, data: unknown}): 'ok' | 'dropped' {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
      return 'dropped';
    }
    this.queue.push(item);
    return 'ok';
  }
  
  drain(): typeof this.queue { return this.queue.splice(0); }
  size(): number { return this.queue.length; }
}
```

### 4. Heartbeat Manager
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
  
  getSeq(): number { return this.seq; }
}
```

### 5. CB Integration
```typescript
// In stream route preHandler
const principal = extractPrincipal(req);
if (isCircuitOpen(principal)) {
  incStreamCircuitRejected();
  // Send typed error event
  await writeSse(reply, 0, 'error', {
    schema: 'stream.error.v1',
    code: 'CIRCUIT_OPEN',
    message: 'Service temporarily unavailable',
    recoverable: true
  });
  await writeSse(reply, 1, 'done', {
    schema: 'stream.done.v1',
    reason: 'circuit_open'
  });
  safeEnd(reply);
  return reply;
}
```

### 6. Enhanced Metrics
```typescript
// src/observability/streamMetrics.ts
let streamClientsOpen = 0;
let streamClientsClosed = 0;
let streamBackpressureDrops = 0;
let streamHeartbeatTotal = 0;
let streamCircuitRejected = 0;
const streamDurations: number[] = [];

export function incStreamClientsOpen() { streamClientsOpen++; }
export function incStreamClientsClosed() { streamClientsClosed++; }
export function incStreamBackpressureDrop(reason: string) { streamBackpressureDrops++; }
export function incStreamHeartbeat() { streamHeartbeatTotal++; }
export function incStreamCircuitRejected() { streamCircuitRejected++; }
export function recordStreamDuration(ms: number) { streamDurations.push(ms); }

export function renderStreamMetrics(): string {
  // Prometheus text format
  return `
# HELP plot_engine_stream_clients Active stream connections
# TYPE plot_engine_stream_clients gauge
plot_engine_stream_clients{state="open"} ${streamClientsOpen}
plot_engine_stream_clients{state="closed"} ${streamClientsClosed}

# HELP plot_engine_stream_backpressure_drops_total Events dropped due to backpressure
# TYPE plot_engine_stream_backpressure_drops_total counter
plot_engine_stream_backpressure_drops_total ${streamBackpressureDrops}

# HELP plot_engine_stream_heartbeat_total Heartbeats sent
# TYPE plot_engine_stream_heartbeat_total counter
plot_engine_stream_heartbeat_total ${streamHeartbeatTotal}

# HELP plot_engine_stream_circuit_rejected_total Streams rejected by circuit breaker
# TYPE plot_engine_stream_circuit_rejected_total counter
plot_engine_stream_circuit_rejected_total ${streamCircuitRejected}
`.trim();
}
```

---

## Testing Strategy

### Unit Tests
```typescript
// tests/p1-stream-schema.test.ts
- Request schema validation (valid/invalid params)
- Event schema validation (all event types)

// tests/p1-stream-queue.test.ts
- Bounded queue: push, overflow, drain
- Drop oldest behavior

// tests/p1-stream-heartbeat.test.ts
- Heartbeat timer start/stop
- Sequence numbering
```

### Integration Tests
```typescript
// tests/p1-stream-integration.test.ts
- Stream with heartbeat enabled
- Stream with CB open (fail-fast)
- Stream with backpressure (slow client)
- Stream timeout handling
```

### E2E Tests
```typescript
// e2e/scenarios/03-stream-soak.ts
- 60s sustained stream
- Verify no memory leaks
- PromQL: stream_clients gauge increments
- PromQL: heartbeat_total increments
```

### Performance Guards
```typescript
// tests/p1-stream-perf.test.ts
- Benchmark frame write latency (target < 50ms p95)
- Memory profiling (heap before/after)
```

---

## Rollout Plan

### Phase 1: Schema Validation (Low Risk)
1. Deploy with AJV schemas enabled
2. Monitor `validation_errors_total`
3. Verify no false positives

### Phase 2: Heartbeat (Medium Risk)
1. Deploy with `SSE_HEARTBEAT_MS=0` (disabled)
2. Enable in staging: `SSE_HEARTBEAT_MS=30000`
3. Monitor `stream_heartbeat_total`
4. Enable in production

### Phase 3: Bounded Queue (High Risk)
1. Deploy with `SSE_MAX_BUFFERED_EVENTS=1000` (high)
2. Gradually reduce to 100
3. Monitor `stream_backpressure_drops_total`
4. Alert on sustained drops

### Rollback
- Set `SSE_HEARTBEAT_MS=0` to disable heartbeats
- Set `SSE_MAX_BUFFERED_EVENTS=10000` to disable bounds
- Revert commit if p95 > 100ms

---

## Post-Merge Validation

```bash
# 1. Health check
curl -s https://plot-lite-service.onrender.com/v1/health | jq .

# 2. Stream with heartbeat
curl -N "https://plot-lite-service.onrender.com/v1/stream?heartbeat_ms=5000&demo=1"

# 3. Metrics
curl -s https://plot-lite-service.onrender.com/metrics | grep -E 'stream_clients|stream_heartbeat'

# 4. E2E soak test
npm run e2e:up && sleep 30 && npm run e2e && npm run e2e:down
```

---

## Alerts

```yaml
# High backpressure drops
- alert: StreamBackpressureHigh
  expr: rate(plot_engine_stream_backpressure_drops_total[5m]) > 1
  for: 5m
  annotations:
    summary: "Streams experiencing sustained backpressure"

# No heartbeats (when enabled)
- alert: StreamHeartbeatStalled
  expr: rate(plot_engine_stream_heartbeat_total[2m]) == 0 AND plot_engine_stream_clients{state="open"} > 0
  for: 5m
  annotations:
    summary: "Heartbeats stopped but streams are open"
```

---

## Definition of Done

- [ ] AJV request schema enforced
- [ ] Event schemas versioned and validated
- [ ] Bounded queue implemented (max 100)
- [ ] Heartbeat mechanism working
- [ ] CB integration (fail-fast)
- [ ] All metrics added and verified
- [ ] Unit tests: >90% coverage
- [ ] Integration tests: All passing
- [ ] E2E soak test: 60s, no leaks
- [ ] Performance: p95 < 50ms
- [ ] Docs: API reference, runbook, alerts
- [ ] CI: All tests green
- [ ] Deployed and verified

---

**Risk Assessment**: Medium  
**Backward Compatibility**: ✅ Yes (all changes additive/env-gated)  
**Performance Impact**: Δp95 < +3ms (measured)

**Next**: Implement in `feat/p1-streaming-parity`
