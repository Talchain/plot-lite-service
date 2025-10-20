# P1: Streaming Endpoint Parity & Backpressure

**Status**: 🚧 IN PROGRESS  
**Priority**: P1  
**Owner**: Autonomous Agent  
**Target**: v2.3.0

---

## Problem

`/v1/stream` currently has basic backpressure handling but lacks:
1. **Request schema validation** (AJV) - no strict input validation
2. **Response/event schema versioning** - events are loosely typed
3. **Comprehensive backpressure metrics** - limited visibility into queue depth
4. **Heartbeat/keep-alive** - no periodic pings to detect stale connections
5. **Graceful degradation** - no circuit breaker integration
6. **Memory bounds** - no hard limits on buffered data

---

## Scope

### In Scope
- AJV request schema for `/v1/stream` query parameters
- Versioned event schemas (`hello.v1`, `token.v1`, `done.v1`, `error.v1`)
- Enhanced backpressure metrics (queue depth, stalls, bytes/sec)
- Heartbeat mechanism (configurable interval, default 30s)
- Memory-bounded event queue (max 100 events buffered)
- Integration with circuit breaker (fail-fast when CB open)
- E2E soak test (10-minute stream under load)
- Performance guard (p95 frame latency < 50ms)

### Out of Scope
- Changing SSE format (remains text/event-stream)
- WebSocket support
- Binary streaming
- Multi-tenant stream isolation (handled by existing rate limiter)

---

## API Changes

### Request Schema
```typescript
// Query parameters
{
  demo?: 0 | 1,           // Demo mode (existing)
  latency_ms?: number,    // Artificial delay (existing)
  heartbeat_ms?: number,  // NEW: Heartbeat interval (default 30000, max 60000)
  max_events?: number     // NEW: Max events before auto-close (default unlimited)
}
```

### Event Schemas
```typescript
// hello.v1
{
  schema: 'hello.v1',
  ts: string,             // ISO 8601
  trace_id?: string,      // Optional trace ID
  heartbeat_ms: number    // Negotiated heartbeat interval
}

// token.v1
{
  schema: 'token.v1',
  text: string,
  index: number
}

// heartbeat.v1 (NEW)
{
  schema: 'heartbeat.v1',
  ts: string,
  seq: number             // Heartbeat sequence number
}

// done.v1
{
  schema: 'done.v1',
  reason: 'complete' | 'timeout' | 'client_cancel' | 'error' | 'circuit_open'
}

// error.v1
{
  schema: 'error.v1',
  code: string,           // Error code
  message: string,
  recoverable: boolean
}
```

---

## Configuration

### Environment Variables
```bash
# Existing
SSE_PER_IP_MAX=5
SSE_GLOBAL_MAX=100
SSE_SLOT_MAX_MS=300000  # 5 minutes

# NEW
SSE_HEARTBEAT_MS=30000          # Default heartbeat interval
SSE_MAX_BUFFERED_EVENTS=100     # Max events in memory per stream
SSE_BACKPRESSURE_THRESHOLD=10   # Warn when queue > this
```

---

## Security & Performance Risks

### Security
- **Risk**: Unbounded heartbeats could be used for DoS
  - **Mitigation**: Cap `heartbeat_ms` at 60s, enforce global/per-IP limits
- **Risk**: Large event payloads could exhaust memory
  - **Mitigation**: Hard limit on buffered events (100), drop oldest on overflow

### Performance
- **Risk**: Heartbeat timers add CPU overhead
  - **Mitigation**: Use `unref()` on timers, batch cleanup
- **Risk**: Schema validation adds latency
  - **Mitigation**: Validate once at start, cache compiled schemas
- **Target**: p95 frame latency < 50ms (measured end-to-end)

---

## Metrics

### New Metrics
```
# Backpressure depth
plot_engine_sse_queue_depth{stream_id} gauge

# Heartbeats sent
plot_engine_sse_heartbeat_total counter

# Events dropped due to backpressure
plot_engine_sse_events_dropped_total{reason="overflow|backpressure"} counter

# Frame latency histogram
plot_engine_sse_frame_latency_ms histogram

# Bytes sent
plot_engine_sse_bytes_sent_total counter

# Circuit breaker rejections
plot_engine_sse_circuit_rejected_total counter
```

### Existing Metrics (keep)
- `plot_engine_sse_open_total`
- `plot_engine_sse_closed_total`
- `plot_engine_sse_timeout_total`
- `plot_engine_stream_rate_limited_total`
- `plot_engine_stream_disconnect_total`
- `plot_engine_stream_write_backpressure_total`

---

## Rollout

### Phase 1: Schema Validation (Low Risk)
1. Add AJV schemas for request/response
2. Deploy with validation enabled
3. Monitor validation error metrics

### Phase 2: Heartbeat (Medium Risk)
1. Deploy with `SSE_HEARTBEAT_MS=0` (disabled)
2. Enable in staging with 30s interval
3. Monitor heartbeat metrics, client compatibility
4. Enable in production

### Phase 3: Memory Bounds (High Risk)
1. Deploy with `SSE_MAX_BUFFERED_EVENTS=1000` (high limit)
2. Gradually reduce to 100 while monitoring drops
3. Alert on sustained drops

### Rollback
- Set `SSE_HEARTBEAT_MS=0` to disable heartbeats
- Set `SSE_MAX_BUFFERED_EVENTS=10000` to effectively disable bounds
- Revert to previous version if frame latency > 100ms p95

---

## Testing

### Unit Tests
- Event schema validation (AJV)
- Heartbeat timer logic
- Queue overflow behavior
- Circuit breaker integration

### Integration Tests
- Request schema validation
- Heartbeat delivery
- Backpressure handling
- Memory bounds enforcement

### E2E Tests
- **Soak test**: 10-minute stream, verify no memory growth
- **Load test**: 50 concurrent streams, measure p95 latency
- **Chaos test**: Induce backpressure, verify graceful degradation
- **PromQL assertions**: Verify metrics increment correctly

### Performance Guards
- Benchmark frame write latency (target < 50ms p95)
- Memory profiling (heap snapshots before/after)

---

## Documentation

### API Reference
- Update `/v1/stream` docs with new query params
- Document event schemas with examples
- Add client examples (curl, fetch, EventSource)

### Runbook
- Heartbeat tuning guide
- Backpressure troubleshooting
- Memory bounds adjustment

### Alerts
```yaml
# High backpressure
- alert: SSEHighBackpressure
  expr: plot_engine_sse_queue_depth > 50
  for: 5m
  annotations:
    summary: "SSE streams experiencing sustained backpressure"

# Events dropped
- alert: SSEEventsDropped
  expr: rate(plot_engine_sse_events_dropped_total[5m]) > 1
  for: 2m
  annotations:
    summary: "SSE events being dropped due to backpressure"
```

---

## Definition of Done

- [ ] AJV request schema added and enforced
- [ ] Event schemas versioned and documented
- [ ] Heartbeat mechanism implemented and tested
- [ ] Memory-bounded queue with overflow handling
- [ ] Circuit breaker integration (fail-fast when open)
- [ ] All metrics added and verified in /metrics
- [ ] Unit tests: 100% coverage of new code
- [ ] Integration tests: All scenarios passing
- [ ] E2E soak test: 10 minutes, no memory growth
- [ ] Performance: p95 frame latency < 50ms
- [ ] Docs: API reference, runbook, alerts
- [ ] CI: All tests green
- [ ] Deployed to staging and verified
- [ ] Deployed to production and verified

---

**Next Steps**: Implement in `feat/p1-streaming-parity` branch
