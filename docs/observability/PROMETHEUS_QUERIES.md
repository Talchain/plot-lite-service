# Prometheus Queries - Copy-Paste Ready

**Last Updated**: 2025-10-20

---

## Request Performance

### Request Rate (RPS)
```promql
# Overall request rate (5m window)
rate(plot_engine_request_duration_seconds_count[5m])

# Request rate by route
sum by (route) (rate(plot_engine_request_duration_seconds_count[5m]))

# Request rate by status code
sum by (status) (rate(plot_engine_request_duration_seconds_count[5m]))
```

### Latency Percentiles
```promql
# P50 latency (median)
histogram_quantile(0.50, rate(plot_engine_request_duration_seconds_bucket[5m]))

# P95 latency
histogram_quantile(0.95, rate(plot_engine_request_duration_seconds_bucket[5m]))

# P99 latency
histogram_quantile(0.99, rate(plot_engine_request_duration_seconds_bucket[5m]))

# P95 by route
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_seconds_bucket[5m])))
```

### Error Rate
```promql
# 5xx error rate
rate(plot_engine_request_duration_seconds_count{status=~"5.."}[5m])

# 4xx error rate
rate(plot_engine_request_duration_seconds_count{status=~"4.."}[5m])

# Error ratio (errors / total requests)
sum(rate(plot_engine_request_duration_seconds_count{status=~"[45].."}[5m])) 
/ 
sum(rate(plot_engine_request_duration_seconds_count[5m]))
```

---

## Validation Metrics

### Validation Errors
```promql
# Validation errors in last 5 minutes
increase(plot_engine_validation_errors_total[5m])

# Validation error rate
rate(plot_engine_validation_errors_total[5m])

# Validation errors by route
sum by (route) (increase(plot_engine_validation_errors_total[5m]))

# Request vs response validation errors
sum by (phase) (increase(plot_engine_validation_errors_total[5m]))
```

### Validation Error Ratio
```promql
# Validation errors as % of total requests to /v1/run
sum(rate(plot_engine_validation_errors_total{route="/v1/run"}[5m]))
/
sum(rate(plot_engine_request_duration_seconds_count{route="/v1/run"}[5m]))
* 100
```

---

## Streaming Metrics (Legacy)

### Active Connections
```promql
# Current open SSE connections
plot_engine_stream_clients{state="open"}

# Connection delta (opens - closes)
plot_engine_stream_clients{state="open"} - plot_engine_stream_clients{state="closed"}
```

---

## Enhanced Streaming Metrics (P2 - Future)

### Heartbeats
```promql
# Heartbeats sent in last 5 minutes
increase(plot_engine_stream_heartbeat_total[5m])

# Heartbeat rate
rate(plot_engine_stream_heartbeat_total[5m])
```

### Backpressure
```promql
# Events dropped due to backpressure (5m)
increase(plot_engine_stream_backpressure_drops_total[5m])

# Backpressure drop rate
rate(plot_engine_stream_backpressure_drops_total[5m])

# Backpressure ratio (drops / total events)
sum(rate(plot_engine_stream_backpressure_drops_total[5m]))
/
sum(rate(plot_engine_stream_events_total[5m]))
```

### Circuit Breaker
```promql
# Circuit breaker rejections (5m)
increase(plot_engine_stream_circuit_rejected_total[5m])

# Circuit breaker rejection rate
rate(plot_engine_stream_circuit_rejected_total[5m])
```

---

## Rate Limiting

### Rate Limit Hits
```promql
# 429 responses in last 5 minutes
increase(plot_engine_rate_limit_hits_total[5m])

# Rate limit hit rate
rate(plot_engine_rate_limit_hits_total[5m])

# Rate limits by route
sum by (route) (increase(plot_engine_rate_limit_hits_total[5m]))
```

---

## System Health

### Memory Usage
```promql
# Heap used (MB)
nodejs_heap_size_used_bytes / 1024 / 1024

# Heap utilization (%)
(nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes) * 100
```

### Event Loop Lag
```promql
# Event loop lag (ms)
nodejs_eventloop_lag_seconds * 1000

# Event loop lag P95
histogram_quantile(0.95, rate(nodejs_eventloop_lag_seconds_bucket[5m])) * 1000
```

### CPU Usage
```promql
# CPU usage rate
rate(process_cpu_user_seconds_total[5m]) + rate(process_cpu_system_seconds_total[5m])
```

---

## Alerting Queries

### High Error Rate
```promql
# Alert if error rate > 5% for 5 minutes
(
  sum(rate(plot_engine_request_duration_seconds_count{status=~"5.."}[5m]))
  /
  sum(rate(plot_engine_request_duration_seconds_count[5m]))
) > 0.05
```

### High Latency
```promql
# Alert if P95 > 1s for 5 minutes
histogram_quantile(0.95, rate(plot_engine_request_duration_seconds_bucket[5m])) > 1
```

### High Validation Error Rate
```promql
# Alert if validation errors > 10/sec for 5 minutes
rate(plot_engine_validation_errors_total[5m]) > 10
```

### Memory Leak Detection
```promql
# Alert if heap usage increasing steadily
deriv(nodejs_heap_size_used_bytes[30m]) > 1000000  # 1MB/min increase
```

---

## Dashboard Panels

### Request Overview Panel
```promql
# Panel 1: Request Rate
sum(rate(plot_engine_request_duration_seconds_count[5m]))

# Panel 2: P95 Latency
histogram_quantile(0.95, rate(plot_engine_request_duration_seconds_bucket[5m]))

# Panel 3: Error Rate
sum(rate(plot_engine_request_duration_seconds_count{status=~"[45].."}[5m]))

# Panel 4: Success Rate (%)
(
  sum(rate(plot_engine_request_duration_seconds_count{status=~"2.."}[5m]))
  /
  sum(rate(plot_engine_request_duration_seconds_count[5m]))
) * 100
```

### Validation Panel
```promql
# Panel 1: Validation Errors by Route
sum by (route) (rate(plot_engine_validation_errors_total[5m]))

# Panel 2: Validation Error Ratio
sum(rate(plot_engine_validation_errors_total[5m]))
/
sum(rate(plot_engine_request_duration_seconds_count[5m]))
```

---

## Testing Queries Locally

```bash
# Start local server with metrics enabled
PROMETHEUS_ENABLE=1 npm start

# Query metrics endpoint
curl -s http://localhost:3000/metrics | grep plot_engine

# Test specific metric
curl -s http://localhost:3000/metrics | grep plot_engine_validation_errors_total
```

---

## See Also

- [Metrics Catalog](./METRICS_CATALOG.md) - Full metric definitions
- [Alerts](./ALERTS.yaml) - Alert rule configurations
- [Grafana Dashboard](./GRAFANA_DASHBOARD.json) - Pre-built dashboard
