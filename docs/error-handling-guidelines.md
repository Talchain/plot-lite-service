# Error Handling Guidelines

## Prohibiting Empty Catch Blocks

As of v1.6.0, empty catch blocks are prohibited by ESLint. All errors must be logged or explicitly documented.

### ❌ BAD: Empty Catch Block
```typescript
try {
  someRiskyOperation();
} catch {}  // ❌ ESLint error: no-empty
```

### ✅ GOOD: Log the Error
```typescript
try {
  someRiskyOperation();
} catch (err) {
  req.log?.warn?.({
    evt: 'risky_operation_failed',
    err,
    context: 'additional_context'
  }, 'Risky operation failed');
}
```

---

## Error Handling Patterns by Category

### 1. **Critical Errors** (Auth, Routing, Persistence)
**Rule:** Always log at ERROR level with structured fields

```typescript
try {
  clearInflight(principal, idempotencyKey);
} catch (err) {
  req.log?.error?.({
    evt: 'clear_inflight_failed',
    reqId: req.id,
    principal,
    error: err instanceof Error ? err.message : String(err)
  }, 'Failed to clear inflight idempotency key');
  // Critical: this could permanently block requests with this key
}
```

**Key Points:**
- Use `evt` field for filtering (e.g., 'auth_header_failed', 'clear_inflight_failed')
- Include `reqId` for request tracing
- Add `context` fields for debugging (principal, key, etc.)
- Add comment explaining business impact

---

### 2. **User-Visible Errors** (Validation, Config, Response Formatting)
**Rule:** Log at WARN level with actionable context

```typescript
try {
  reply.header('Idempotent-Replayed', '1');
} catch (err) {
  req.log?.warn?.({
    evt: 'idempotent_header_failed',
    reqId: req.id,
    replayed: true,
    err
  }, 'Failed to set Idempotent-Replayed header');
}
```

**Key Points:**
- Use `evt` field for monitoring
- Include request context (reqId, route, etc.)
- Log error details for debugging

---

### 3. **Best-Effort Operations** (Metrics, Headers, Cleanup)
**Rule:** Log at DEBUG level (optional) or use defensive comments

```typescript
// Option A: Debug logging
try {
  incMetricCounter('sse_open');
} catch (err) {
  console.error(JSON.stringify({
    level: 'debug',
    evt: 'metric_inc_failed',
    metric: 'sse_open',
    timestamp: new Date().toISOString()
  }));
}

// Option B: Explicit comment (use sparingly)
try {
  reply.removeHeader('X-Content-Type-Options');
} catch {
  // Best-effort header removal for SSE responses
  // Not logging as this is a benign fallback
}
```

**Key Points:**
- Only use empty catch with explicit comment justifying why
- Prefer debug logging for visibility
- Document as "best-effort" in code comments

---

## Structured Logging Fields

### Required Fields
- **evt**: Event type for filtering (e.g., 'auth_header_failed', 'stream_cleanup_failed')
- **reqId**: Request ID for tracing (from `req.id`)
- **err**: Error object (includes stack trace)

### Recommended Fields
- **route**: Endpoint path (e.g., '/v1/run', '/v1/stream')
- **context**: Additional context (e.g., 'early_400_exit', 'during_validation')
- **principal**: User/API key identifier (never log full token!)

### Example
```typescript
req.log?.error?.({
  evt: 'auth_header_failed',        // Required: for filtering
  reqId: req.id,                    // Required: for tracing
  route: '/v1/run',                 // Recommended: endpoint
  context: '401_response',          // Recommended: where in flow
  err                               // Required: error details
}, 'Failed to set WWW-Authenticate header');
```

---

## ESLint Configuration

### Enabled Rules
```json
{
  "rules": {
    "no-empty": ["error", { "allowEmptyCatch": false }],
    "@typescript-eslint/no-empty-function": ["error"]
  }
}
```

### Overrides for Tests
Test files can use empty catch blocks for brevity:
```json
{
  "overrides": [{
    "files": ["*.test.ts", "tests/**/*.ts"],
    "rules": {
      "no-empty": "off"
    }
  }]
}
```

---

## Migration Strategy

### Phase 1: Critical Paths (Sprint 2)
1. Auth/authorization failures → Log with evt: 'auth_*_failed'
2. Idempotency key management → Log with evt: 'clear_inflight_failed'
3. SSE stream cleanup → Log with evt: 'stream_cleanup_failed'

### Phase 2: User-Visible (Sprint 3)
1. Validation errors → Log with evt: 'validation_*_failed'
2. Response formatting → Log with evt: '*_header_failed'
3. Cache operations → Log with evt: 'cache_*_failed'

### Phase 3: Best-Effort (Sprint 4)
1. Metrics increments → Log at debug level
2. Header cleanup → Add explicit comments
3. Optional operations → Document as best-effort

---

## Monitoring

### Key Metrics to Alert On
```
# Auth failures
evt:"auth_header_failed" | count by minute > 10

# Idempotency leaks
evt:"clear_inflight_failed" | count by minute > 5

# Stream cleanup failures
evt:"stream_cleanup_failed" | count by minute > 20
```

### Dashboard Queries
```
# Top error events
evt:(*_failed OR *_error) | top 10 by count

# Error rate by route
evt:*_failed | count by route

# Error trend over time
evt:*_failed | timechart count by evt
```

---

## Pre-Commit Hook

Add to `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm run lint
```

This ensures no new empty catch blocks are committed.

---

## FAQs

### Q: When is it okay to use an empty catch block?
**A:** Only for best-effort operations where failure has zero business impact (metrics, optional header cleanup). Even then, prefer debug logging for visibility.

### Q: How do I handle errors in onSend/onResponse hooks?
**A:** Use `try/catch` with logging. Fastify hooks don't have built-in error handling.
```typescript
app.addHook('onSend', async (req, reply, payload) => {
  try {
    reply.header('X-Custom-Header', 'value');
  } catch (err) {
    req.log?.warn?.({ evt: 'header_set_failed', err }, 'Failed to set custom header');
  }
  return payload;
});
```

### Q: What if logging itself throws an error?
**A:** Use defensive coding with fallback to console:
```typescript
try {
  criticalOperation();
} catch (err) {
  try {
    req.log?.error?.({ evt: 'critical_op_failed', err }, 'Critical operation failed');
  } catch (logErr) {
    console.error('[FALLBACK] Critical operation failed:', err, '| Log error:', logErr);
  }
}
```

### Q: How do I test error logging?
**A:** Mock the logger and verify it was called:
```typescript
it('logs error when operation fails', async () => {
  const mockLog = { error: vi.fn() };
  const req = { log: mockLog };

  await handler(req, reply);

  expect(mockLog.error).toHaveBeenCalledWith(
    expect.objectContaining({ evt: 'operation_failed' }),
    expect.any(String)
  );
});
```

---

## References

- [Empty Catch Remediation Roadmap](/tmp/empty-catch-remediation-roadmap.md)
- [Classification Report](/tmp/empty-catches-classified.json)
- [ESLint no-empty rule](https://eslint.org/docs/rules/no-empty)
- [Fastify Logging](https://fastify.dev/docs/latest/Reference/Logging/)
- [Pino Logger](https://getpino.io/)
