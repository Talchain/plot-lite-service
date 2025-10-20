# How To: Test Metrics Endpoint

Quick guide for testing Prometheus metrics locally and in production.

---

## Local Testing

### 1. Start Server with Metrics Enabled
```bash
# Set environment variable
export PROMETHEUS_ENABLE=1
export PRINCIPAL_HMAC_SECRET_ACTIVE=$(openssl rand -hex 32)

# Start server
npm start
```

### 2. Verify Metrics Endpoint
```bash
# Check endpoint is accessible
curl -s http://localhost:3000/metrics | head -20

# Should see Prometheus format:
# HELP plot_engine_request_duration_seconds ...
# TYPE plot_engine_request_duration_seconds histogram
```

### 3. Trigger Specific Metrics

#### Validation Errors
```bash
# Send invalid request (missing required field)
curl -s -H 'content-type: application/json' -d '{}' \
  http://localhost:3000/v1/run

# Check validation counter increased
curl -s http://localhost:3000/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run"'
```

#### Request Duration
```bash
# Send valid request
curl -s -H 'content-type: application/json' \
  -d '{"graph":{"nodes":[],"edges":[]}}' \
  http://localhost:3000/v1/run?demo=1

# Check request duration histogram
curl -s http://localhost:3000/metrics | \
  grep 'plot_engine_request_duration_seconds'
```

#### Streaming Metrics
```bash
# Start SSE stream
curl -N http://localhost:3000/v1/stream?demo=1 &
STREAM_PID=$!

# Check active connections
curl -s http://localhost:3000/metrics | \
  grep 'plot_engine_stream_clients{state="open"}'

# Stop stream
kill $STREAM_PID
```

---

## Production Testing

### 1. Verify Metrics Enabled
```bash
# Check health endpoint
curl -s https://plot-lite-service.onrender.com/v1/health | \
  jq '.features.prometheus'

# Access metrics endpoint
curl -s https://plot-lite-service.onrender.com/metrics | head -20
```

### 2. Trigger and Verify Metrics

#### Validation Errors
```bash
# Send 3 invalid requests
for i in {1..3}; do
  curl -s -o /dev/null -H 'content-type: application/json' -d '{}' \
    https://plot-lite-service.onrender.com/v1/run
  sleep 1
done

# Verify counter increased by 3
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"}'
```

#### Request Rate
```bash
# Send multiple requests
for i in {1..10}; do
  curl -s https://plot-lite-service.onrender.com/v1/health > /dev/null
done

# Check request count
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_request_duration_seconds_count{route="/v1/health"'
```

---

## Automated Testing

### Unit Test Example
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Metrics Endpoint', () => {
  let app;
  let baseUrl;

  beforeAll(async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    app = await createServer();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes metrics endpoint', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    
    const text = await response.text();
    expect(text).toContain('# HELP');
    expect(text).toContain('# TYPE');
  });

  it('increments validation counter on invalid request', async () => {
    // Get baseline
    const before = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const beforeMatch = before.match(/plot_engine_validation_errors_total\{.*\} (\d+)/);
    const beforeCount = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    // Trigger validation error
    await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });

    // Check counter increased
    const after = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const afterMatch = after.match(/plot_engine_validation_errors_total\{.*\} (\d+)/);
    const afterCount = afterMatch ? parseInt(afterMatch[1], 10) : 0;

    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});
```

---

## Troubleshooting

### Metrics Endpoint Returns 404
**Cause**: `PROMETHEUS_ENABLE` not set to `1`  
**Fix**: Set environment variable and restart server

### Metrics Show HELP/TYPE Only (No Samples)
**Cause**: No requests have been made yet, or metric not being incremented  
**Fix**: 
1. Trigger the metric (send requests)
2. Check code is calling metric increment functions
3. Verify metric labels match exactly

### Counter Not Incrementing
**Cause**: Metric increment code not being reached  
**Fix**:
1. Add logging before metric increment
2. Verify request path matches expected route
3. Check feature flags/conditions

### High Memory Usage
**Cause**: Too many unique label combinations (high cardinality)  
**Fix**:
1. Review metric labels - keep cardinality low
2. Use bounded label values
3. Avoid user IDs or timestamps in labels

---

## Best Practices

1. **Test Locally First**: Always verify metrics work locally before deploying
2. **Use Helpers**: Create reusable test helpers for metric polling
3. **Wait for Propagation**: Metrics may take 1-2 seconds to update
4. **Check Labels**: Ensure label values match exactly (case-sensitive)
5. **Monitor Cardinality**: Keep unique label combinations < 1000 per metric
6. **Document New Metrics**: Add to METRICS_CATALOG.md immediately

---

## See Also

- [Metrics Catalog](./METRICS_CATALOG.md) - All available metrics
- [Prometheus Queries](./PROMETHEUS_QUERIES.md) - Ready-to-use queries
- [Alerts](./ALERTS.yaml) - Alert configurations
