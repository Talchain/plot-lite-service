# P2: Idempotency & Replay Safety

**Status**: �� Implementation  
**Priority**: P2  
**Target**: Safe retries without duplicate side effects

---

## Problem Statement

Current state:
- `/v1/run` recomputes on every request (no idempotency)
- `/v1/stream` cannot resume after disconnect
- Clients cannot safely retry without risk of duplicate work
- No replay protection

**Risk**: Duplicate computations, wasted resources, inconsistent results on retry.

---

## Scope

### In Scope ✅
- Idempotency for `/v1/run` via `Idempotency-Key` header
- Deterministic cache (LRU + TTL, memory-bounded)
- Resume tokens for `/v1/stream` (best-effort)
- Bounded ring buffer for stream replay
- Metrics for hits/misses/resumes
- Client examples and operational docs

### Out of Scope ❌
- Persistent storage (in-memory only)
- Cross-instance coordination (single-instance cache)
- Guaranteed delivery (best-effort only)
- Idempotency for other routes (defer to future)

---

## Design

### 1. Idempotency for `/v1/run`

#### Header
```
Idempotency-Key: <client-generated-uuid>
```
- Case-insensitive
- Optional (backward compatible)
- Client responsibility to generate unique keys

#### Cache Key
```typescript
{
  method: 'POST',
  path: '/v1/run',
  principal: string,        // From extractPrincipal()
  bodyHash: string,         // SHA-256 of request body
  idempotencyKey: string,   // From header
  version: 'v1'             // API version
}
```

#### Cache Value
```typescript
{
  statusCode: number,
  body: unknown,            // Full response body
  headers: {                // Subset of response headers
    'content-type': string,
    'x-request-id'?: string
  },
  computedAt: number,       // Timestamp
  expiresAt: number         // TTL expiry
}
```

#### Behavior
1. If `Idempotency-Key` present:
   - Check cache with composite key
   - On **hit**: Return cached response (status + body + headers)
   - On **miss**: Compute, cache, return
2. If no `Idempotency-Key`: Skip cache (existing behavior)

### 2. Resume Tokens for `/v1/stream`

#### Resume Token Format
```typescript
{
  streamId: string,         // Unique stream identifier
  lastEventId: number,      // Last acknowledged event ID
  issuedAt: number          // Timestamp
}
```
Encoded as Base64 JWT-like string (no signature, just encoding).

#### Header
```
X-Resume-From: <base64-encoded-token>
```

#### Ring Buffer
- Bounded circular buffer (max 2000 tokens per stream)
- Stores last N events for replay
- Evicts oldest when full
- Per-stream isolation

#### Behavior
1. Client sends `X-Resume-From` header
2. Server decodes token, validates `streamId`
3. If buffer has events after `lastEventId`:
   - Replay from buffer
   - Emit `stream_resume_total{result="hit"}`
4. If buffer expired/overflow:
   - Start fresh stream
   - Emit `stream_resume_total{result="miss|expired|overflow"}`

---

## Configuration

### Environment Variables
```bash
# Idempotency
IDEMPOTENCY_ENABLE=1                    # Enable idempotency (default 0)
IDEMPOTENCY_TTL_MS=1200000              # 20 minutes
IDEMPOTENCY_MAX_ENTRIES=10000           # Max cache entries

# Stream Resume
STREAM_RESUME_ENABLE=1                  # Enable resume (default 0)
STREAM_RESUME_BUFFER=2000               # Max events per stream
STREAM_RESUME_TTL_MS=300000             # 5 minutes
```

---

## Security & Performance

### Security
- **Size limits**: Request body max 1MB (existing)
- **Cache poisoning**: Principal-scoped keys prevent cross-user attacks
- **TTL enforcement**: Automatic expiry prevents unbounded growth
- **No secret logging**: Redact principals in debug logs

### Performance
- **Target**: Δp95 < +3ms for `/v1/run` (cache lookup overhead)
- **Memory**: Bounded by `IDEMPOTENCY_MAX_ENTRIES` × avg response size
- **Cache hit**: O(1) lookup (Map-based LRU)
- **Eviction**: O(1) (LRU with doubly-linked list)

---

## Metrics

```
# Idempotency hits
plot_engine_idempotency_hits_total{route="/v1/run"} counter

# Idempotency misses
plot_engine_idempotency_misses_total{route="/v1/run"} counter

# Stream resume results
plot_engine_stream_resume_total{result="hit|miss|expired|overflow"} counter

# Cache evictions
plot_engine_idempotency_evictions_total{reason="ttl|capacity"} counter
```

---

## Implementation Plan

### 1. Idempotency Cache (`src/lib/idempotency-cache.ts`)
```typescript
export class IdempotencyCache {
  private cache: Map<string, CachedResponse>;
  private lru: DoublyLinkedList;
  private maxEntries: number;
  private ttlMs: number;

  set(key: string, value: CachedResponse): void;
  get(key: string): CachedResponse | null;
  evict(reason: 'ttl' | 'capacity'): void;
}
```

### 2. Resume Token Manager (`src/lib/stream-resume.ts`)
```typescript
export class StreamResumeManager {
  private buffers: Map<string, RingBuffer<StreamEvent>>;
  
  createStream(streamId: string): void;
  addEvent(streamId: string, event: StreamEvent): void;
  getEventsAfter(streamId: string, lastEventId: number): StreamEvent[] | null;
  generateToken(streamId: string, lastEventId: number): string;
  parseToken(token: string): ResumeToken | null;
}
```

### 3. Middleware Integration
```typescript
// In /v1/run route
const idempotencyKey = req.headers['idempotency-key'];
if (idempotencyKey && IDEMPOTENCY_ENABLE) {
  const cached = idempotencyCache.get(cacheKey);
  if (cached) {
    incIdempotencyHits('/v1/run');
    return reply.status(cached.statusCode).send(cached.body);
  }
}

// Compute response
const response = await computeResponse(req);

// Cache if idempotency key present
if (idempotencyKey && IDEMPOTENCY_ENABLE) {
  idempotencyCache.set(cacheKey, {
    statusCode: 200,
    body: response,
    headers: { 'content-type': 'application/json' },
    computedAt: Date.now(),
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
  });
  incIdempotencyMisses('/v1/run');
}
```

---

## Testing Strategy

### Unit Tests
```typescript
// tests/p2-idempotency-cache.test.ts
- Cache set/get
- TTL expiry
- LRU eviction
- Key generation

// tests/p2-stream-resume.test.ts
- Ring buffer overflow
- Token encoding/decoding
- Event replay
```

### Integration Tests
```typescript
// tests/p2-idempotency-integration.test.ts
- Duplicate requests return same response_hash
- Late duplicate after TTL returns fresh compute
- No idempotency key → skip cache

// tests/p2-stream-resume-integration.test.ts
- Disconnect/reconnect with X-Resume-From
- Resume from middle of stream
- Expired token starts fresh
```

### E2E Tests
```typescript
// e2e/scenarios/04-idempotency.ts
- Send N duplicates with same key → 1 compute, N-1 hits
- Assert idempotency_hits_total increments
- Assert response_hash identical

// e2e/scenarios/05-stream-resume.ts
- SSE disconnect/reconnect
- Assert stream_resume_total{result="hit"}
- Verify no gaps/duplicates
```

### Performance Tests
```typescript
// tests/p2-idempotency-perf.test.ts
- Benchmark cache lookup overhead (target < 1ms)
- Memory profiling (bounded growth)
```

---

## Rollout Plan

### Phase 1: Idempotency (Low Risk)
1. Deploy with `IDEMPOTENCY_ENABLE=0` (disabled)
2. Enable in staging: `IDEMPOTENCY_ENABLE=1`
3. Monitor `idempotency_hits_total`, `idempotency_misses_total`
4. Verify no performance regression
5. Enable in production

### Phase 2: Stream Resume (Medium Risk)
1. Deploy with `STREAM_RESUME_ENABLE=0` (disabled)
2. Enable in staging: `STREAM_RESUME_ENABLE=1`
3. Monitor `stream_resume_total`
4. Test disconnect/reconnect scenarios
5. Enable in production

### Rollback
- Set `IDEMPOTENCY_ENABLE=0` to disable idempotency
- Set `STREAM_RESUME_ENABLE=0` to disable resume
- Revert commit if Δp95 > +3ms

---

## Post-Merge Validation

```bash
# 1. Health check
curl -s https://plot-lite-service.onrender.com/v1/health | jq .

# 2. Test idempotency
KEY="test-$(uuidgen)"
curl -X POST "https://plot-lite-service.onrender.com/v1/run" \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"Price"}],"edges":[]}}' | jq .model_card.response_hash

# Repeat (should return same hash)
curl -X POST "https://plot-lite-service.onrender.com/v1/run" \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"Price"}],"edges":[]}}' | jq .model_card.response_hash

# 3. Metrics
curl -s https://plot-lite-service.onrender.com/metrics | grep -E 'idempotency_hits|stream_resume'

# 4. E2E
npm run e2e:up && sleep 30 && npm run e2e && npm run e2e:down
```

---

## Alerts

```yaml
# High cache miss rate (potential misconfiguration)
- alert: IdempotencyCacheMissRateHigh
  expr: rate(plot_engine_idempotency_misses_total[5m]) / (rate(plot_engine_idempotency_hits_total[5m]) + rate(plot_engine_idempotency_misses_total[5m])) > 0.9
  for: 10m
  annotations:
    summary: "Idempotency cache miss rate > 90%"

# Stream resume failures
- alert: StreamResumeFailureHigh
  expr: rate(plot_engine_stream_resume_total{result!="hit"}[5m]) > 10
  for: 5m
  annotations:
    summary: "High stream resume failure rate"
```

---

## Definition of Done

- [ ] Idempotency cache implemented (LRU + TTL)
- [ ] Stream resume manager implemented (ring buffer)
- [ ] Middleware integration in `/v1/run` and `/v1/stream`
- [ ] All metrics added and verified
- [ ] Unit tests: >90% coverage
- [ ] Integration tests: All passing
- [ ] E2E tests: Idempotency + resume scenarios
- [ ] Performance: Δp95 < +3ms
- [ ] Docs: Client examples, operational guide
- [ ] CI: All tests green
- [ ] Deployed and verified

---

**Risk Assessment**: Medium  
**Backward Compatibility**: ✅ Yes (all changes opt-in via headers/env)  
**Performance Impact**: Δp95 < +3ms (cache lookup overhead)

**Next**: Implement in `feat/p2-idempotency-replay`
