# Metrics Catalog

**Last Updated**: 2025-10-20  
**Prometheus Endpoint**: `/metrics`

---

## Overview

All metrics are exposed at `/metrics` when `PROMETHEUS_ENABLE=1`. Metrics follow Prometheus naming conventions and include appropriate labels for filtering.

---

## Request Metrics

### `plot_engine_request_duration_seconds`
**Type**: Histogram  
**Description**: Request duration in seconds for all HTTP endpoints  
**Labels**:
- `route`: Request path (e.g., `/v1/run`, `/v1/stream`)
- `method`: HTTP method (GET, POST)
- `status`: HTTP status code

**Usage**:
```promql
# P95 latency by route (5m window)
histogram_quantile(0.95, rate(plot_engine_request_duration_seconds_bucket[5m]))

# Request rate by status
rate(plot_engine_request_duration_seconds_count{status=~"2.."}[5m])
```

---

## Validation Metrics

### `plot_engine_validation_errors_total`
**Type**: Counter  
**Description**: Total number of API validation failures  
**Labels**:
- `route`: Request path where validation failed
- `phase`: `request` or `response`
- `error_type`: `ajv` (JSON Schema validation)

**Usage**:
```promql
# Validation errors in last 5 minutes
increase(plot_engine_validation_errors_total[5m])

# Validation error rate by route
rate(plot_engine_validation_errors_total{route="/v1/run"}[5m])
```

**Alert Example**:
```yaml
- alert: HighValidationErrorRate
  expr: rate(plot_engine_validation_errors_total[5m]) > 10
  for: 5m
  annotations:
    summary: "High validation error rate detected"
```

---

## Streaming Metrics (Legacy Path)

### `plot_engine_stream_clients`
**Type**: Gauge  
**Description**: Current number of active SSE clients  
**Labels**:
- `state`: `open` or `closed`

**Usage**:
```promql
# Active SSE connections
plot_engine_stream_clients{state="open"}

# Connection churn (opens - closes)
plot_engine_stream_clients{state="open"} - plot_engine_stream_clients{state="closed"}
```

---

## Enhanced Streaming Metrics (P2 - Not Yet Live)

### `plot_engine_stream_heartbeat_total`
**Type**: Counter  
**Description**: Total heartbeat events sent to SSE clients  
**Status**: 🚧 Not yet deployed

### `plot_engine_stream_backpressure_drops_total`
**Type**: Counter  
**Description**: Events dropped due to slow consumer backpressure  
**Status**: 🚧 Not yet deployed

### `plot_engine_stream_circuit_rejected_total`
**Type**: Counter  
**Description**: Requests rejected by circuit breaker  
**Status**: 🚧 Not yet deployed

---

## Rate Limiting Metrics

### `plot_engine_rate_limit_hits_total`
**Type**: Counter  
**Description**: Total number of rate limit hits (429 responses)  
**Labels**:
- `route`: Request path
- `limit_type`: Type of rate limit (e.g., `per_ip`, `per_token`)

**Usage**:
```promql
# Rate limit hits in last hour
increase(plot_engine_rate_limit_hits_total[1h])
```

---

## System Metrics

### Node.js Default Metrics
The following standard Node.js metrics are also exposed:
- `nodejs_heap_size_total_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_external_memory_bytes`
- `nodejs_eventloop_lag_seconds`
- `process_cpu_user_seconds_total`
- `process_cpu_system_seconds_total`

---

## Metric Naming Conventions

1. **Prefix**: All custom metrics start with `plot_engine_`
2. **Units**: Include unit suffix (e.g., `_seconds`, `_bytes`, `_total`)
3. **Types**:
   - Counters: `_total` suffix (monotonically increasing)
   - Gauges: Current value (can go up/down)
   - Histograms: `_bucket`, `_sum`, `_count` suffixes
4. **Labels**: Use snake_case, keep cardinality low

---

## Adding New Metrics

When adding new metrics:

1. **Define in code**: Use `prom-client` library
2. **Document here**: Add to appropriate section
3. **Add queries**: Include example PromQL in `PROMETHEUS_QUERIES.md`
4. **Test**: Verify metric appears in `/metrics` output
5. **Alert**: Add alert rules if needed in `ALERTS.yaml`

---

## See Also

- [Prometheus Queries](./PROMETHEUS_QUERIES.md) - Ready-to-use PromQL queries
- [Alerts](./ALERTS.yaml) - Alert rule definitions
- [How to Test Metrics](./HOWTO_test-metrics-endpoint.md) - Local testing guide
