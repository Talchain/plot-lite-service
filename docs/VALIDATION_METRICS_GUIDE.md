# Validation Metrics Guide

## Overview

The PLoT Engine tracks API validation failures via the `plot_engine_validation_errors_total` counter exposed at `/metrics`.

## Metric Definition

```
plot_engine_validation_errors_total{route,phase,error_type} counter
```

### Labels

- **route**: The API endpoint (e.g., `/v1/run`, `/v1/stream`)
- **phase**: Where validation failed
  - `request`: Request validation (body, querystring, params, headers)
  - `response`: Response validation
- **error_type**: Validator type (currently always `ajv`)

## How It Works

1. **Request Validation**: When a client sends invalid input (missing required fields, wrong types, etc.), Fastify/AJV rejects the request with HTTP 400
2. **Response Validation**: When the server generates an invalid response (schema mismatch), Fastify/AJV catches it
3. **Metric Increment**: The global error handler detects validation errors via `err.validation` and increments the counter

## Manual Probing

### Test Request Validation

Send an invalid request to `/v1/run`:

```bash
# Send empty body (missing required fields)
curl -X POST https://plot-lite-service.onrender.com/v1/run \
  -H 'content-type: application/json' \
  -d '{}'

# Expected: HTTP 400

# Check metrics
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run",phase="request"'

# Expected output:
# plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"} 1
```

### Test Response Validation

Response validation errors are rare (server-side bugs). If they occur:

```bash
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run",phase="response"'
```

## Querying in Prometheus

```promql
# Total validation errors across all routes
sum(plot_engine_validation_errors_total)

# Request validation errors only
sum(plot_engine_validation_errors_total{phase="request"})

# Errors for specific route
plot_engine_validation_errors_total{route="/v1/run"}

# Rate of validation errors (per second)
rate(plot_engine_validation_errors_total[5m])
```

## Alerting

### Suggested Alert: High Validation Error Rate

```yaml
- alert: HighValidationErrorRate
  expr: rate(plot_engine_validation_errors_total{phase="request"}[5m]) > 1
  for: 5m
  annotations:
    summary: "High rate of request validation errors"
    description: "{{ $value }} validation errors/sec on {{ $labels.route }}"
```

### Suggested Alert: Response Validation Errors

```yaml
- alert: ResponseValidationErrors
  expr: increase(plot_engine_validation_errors_total{phase="response"}[5m]) > 0
  for: 1m
  annotations:
    summary: "Response validation errors detected (server bug)"
    description: "{{ $value }} response validation errors on {{ $labels.route }}"
```

## Troubleshooting

### Metric shows only HELP/TYPE lines, no samples

**Cause**: No validation errors have occurred yet.

**Solution**: Send an invalid request to trigger the counter (see "Manual Probing" above).

### Counter doesn't increment on invalid requests

**Cause**: Route doesn't have request schema validation enabled.

**Solution**: Check route definition in `src/routes/v1/*.ts` - ensure `schema.body` or `schema.querystring` is defined.

### Counter increments for valid requests

**Cause**: Schema definition is too strict or incorrect.

**Solution**: Review schema in `src/schemas/*.ts` and adjust to match actual valid payloads.

## Implementation Details

### Code Location

- **Metric Definition**: `src/observability/validationMetrics.ts`
- **Increment Logic**: `src/createServer.ts` (error handler)
- **Metric Exposure**: `src/plugins/metrics.ts`

### Error Handler Logic

```typescript
app.setErrorHandler(async (err, req, reply) => {
  const route = req.routerPath || req.routeOptions?.url || req.url?.split('?')[0] || 'unknown';
  
  if (err.validation) {
    const validationContext = err.validationContext;
    const phase = validationContext === 'response' ? 'response' : 'request';
    incValidationError(route, phase, 'ajv');
  }
  
  // ... rest of error handling
});
```

### Fastify Validation Context Values

- `body`: Request body validation
- `querystring`: Query parameter validation
- `params`: URL parameter validation
- `headers`: Header validation
- `response`: Response validation

All except `response` are treated as `phase="request"`.

## Related Metrics

- `plot_engine_request_duration_seconds`: Request latency histogram
- `json_429_total`: Rate limit rejections
- `engine_p95_ms`: Engine processing latency

---

**Last Updated**: 2025-10-20  
**Related PR**: #34 (validation metric fix)
