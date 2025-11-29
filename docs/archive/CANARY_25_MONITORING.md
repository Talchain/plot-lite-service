> ⚠️ This document is a **SIMULATION** used for training/process validation.  
> For a real rollout, use the templates in `templates/rollout/` and fill with live data.

# Canary 25% Monitoring Report

**Date**: 2025-10-18  
**Duration**: 24 hours  
**Scope**: 25% of production fleet (canary pods)

---

## Flag Flip Command

```bash
# Enable RL_CB_ENABLE=1 on canary pods
# Example (adjust to your infrastructure):
kubectl set env deployment/plot-engine -l app=plot-engine,tier=canary RL_CB_ENABLE=1

# Verify flag state
kubectl exec -it $(kubectl get pods -l app=plot-engine,tier=canary -o name | head -1) -- env | grep RL_CB_ENABLE
# Expected: RL_CB_ENABLE=1
```

**Verification**:
```bash
$ curl -s https://canary.example.com/v1/health | jq '.version.flags.RL_CB_ENABLE'
"1"
```

---

## Monitoring Snapshots (Every 15 min for 24h)

### Hour 0 (Initial)

**Timestamp**: 2025-10-18 20:00:00 UTC

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {} (no opens)

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result:
# {route="/v1/run"} 12.3
# {route="/v1/stream"} 8.7

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: 0

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: 0.023 (2.3% utilization)
```

**Health Check**:
```json
{
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0
    },
    "principals": {
      "tracked": 23,
      "open": 0,
      "capacity": 1000
    }
  },
  "principal_extraction": {
    "mode": "fallback"
  }
}
```

---

### Hour 6

**Timestamp**: 2025-10-19 02:00:00 UTC

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {} (no opens)

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result:
# {route="/v1/run"} 11.8 (baseline: 12.3, delta: -4%)
# {route="/v1/stream"} 9.1 (baseline: 8.7, delta: +5%)

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: 0

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: 0.047 (4.7% utilization)
```

**Health Check**:
```json
{
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0
    },
    "principals": {
      "tracked": 47,
      "open": 0,
      "capacity": 1000
    }
  },
  "principal_extraction": {
    "mode": "fallback"
  }
}
```

---

### Hour 12

**Timestamp**: 2025-10-19 08:00:00 UTC

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {} (no opens)

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result:
# {route="/v1/run"} 12.1 (baseline: 12.3, delta: -2%)
# {route="/v1/stream"} 8.9 (baseline: 8.7, delta: +2%)

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: 0

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: 0.062 (6.2% utilization)
```

**Health Check**:
```json
{
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0
    },
    "principals": {
      "tracked": 62,
      "open": 0,
      "capacity": 1000
    }
  },
  "principal_extraction": {
    "mode": "fallback"
  }
}
```

---

### Hour 18

**Timestamp**: 2025-10-19 14:00:00 UTC

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {} (no opens)

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result:
# {route="/v1/run"} 12.4 (baseline: 12.3, delta: +1%)
# {route="/v1/stream"} 8.6 (baseline: 8.7, delta: -1%)

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: 0

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: 0.071 (7.1% utilization)
```

**Health Check**:
```json
{
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0
    },
    "principals": {
      "tracked": 71,
      "open": 0,
      "capacity": 1000
    }
  },
  "principal_extraction": {
    "mode": "fallback"
  }
}
```

---

### Hour 24 (Final)

**Timestamp**: 2025-10-19 20:00:00 UTC

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {} (no opens)

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result:
# {route="/v1/run"} 12.2 (baseline: 12.3, delta: -1%)
# {route="/v1/stream"} 8.8 (baseline: 8.7, delta: +1%)

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: 0

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: 0.078 (7.8% utilization)
```

**Health Check**:
```json
{
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0
    },
    "principals": {
      "tracked": 78,
      "open": 0,
      "capacity": 1000
    }
  },
  "principal_extraction": {
    "mode": "fallback"
  }
}
```

---

## p95 Latency Monitoring

```promql
# p95 latency for breaker-covered routes
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_ms_bucket{route=~"/v1/run|/v1/stream"}[5m])))
```

**Results**:
- Hour 0: /v1/run: 142ms, /v1/stream: 156ms
- Hour 6: /v1/run: 138ms, /v1/stream: 151ms
- Hour 12: /v1/run: 145ms, /v1/stream: 159ms
- Hour 18: /v1/run: 141ms, /v1/stream: 154ms
- Hour 24: /v1/run: 143ms, /v1/stream: 157ms

**Average**: 143ms (within 150ms budget ✅)

---

## Alerts Triggered

**None** ✅

- No P1 alerts (CircuitBreakerStuckOpen, CircuitBreakerGlobalOpen)
- No P2 alerts (CircuitBreakerHighTrips, CircuitBreakerHalfOpenTimeouts, CircuitBreakerDegradedMode)
- No P3 alerts (CircuitBreakerPrincipalCapacityHigh, CircuitBreakerManyPrincipalsOpen, RateLimitSurge)

---

## Pass Gates Validation

- ✅ **Zero P1 alerts** (no stuck open, no capacity full)
- ✅ **Trip rate stable** (0 opens in 24h)
- ✅ **429 baseline unchanged** (±5% variance, within normal)
- ✅ **p95 latency within budget** (143ms avg < 150ms)
- ✅ **No half-open timeouts** (0 in 24h)
- ✅ **Principal capacity healthy** (7.8% < 80% threshold)
- ✅ **No degraded mode** (mode="fallback" throughout)

---

## Status

**Canary 25% (24h Soak)**: ✅ **PASS**

**Ready for 50% rollout**
