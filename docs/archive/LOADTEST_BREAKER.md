# Circuit Breaker Load Test Playbook

**Goal**: Validate circuit breaker behavior under controlled load before production deployment.

**Duration**: ~30 minutes  
**Prerequisites**: Local dev server, `curl`, `jq`, `xargs`

---

## Setup

```bash
# Start dev server with breaker enabled
export RL_CB_ENABLE=1
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)
export RL_CB_FAILURE_THRESHOLD=10  # Lower for faster testing
export RL_CB_WINDOW_MS=5000        # 5s window
export RL_CB_COOLDOWN_MS=10000     # 10s cooldown
export RL_CB_HALF_OPEN_PROBES=3    # 3 probes to close
export RL_CB_HALF_OPEN_TIMEOUT_MS=15000  # 15s timeout

npm run dev
```

**Baseline Health Check:**
```bash
curl -s http://localhost:3000/v1/health | jq '{
  principal_extraction,
  circuit_breaker: .circuit_breaker.global
}'
```

Expected:
- `principal_extraction.mode`: `"fallback"`
- `circuit_breaker.global.state`: `"closed"`

---

## Test 1: Burst Load (Trip Global Circuit)

**Objective**: Verify circuit opens on sustained 429s

**Traffic Shape**: 20 failures in 5s (exceeds threshold of 10)

```bash
# Generate burst of invalid requests (400 → counted as failure)
echo "Sending burst..."
seq 1 20 | xargs -P 10 -I {} curl -s \
  -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o /dev/null -w "%{http_code}\n"

# Check circuit state
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global | {
  state,
  failures,
  last_transition_at
}'
```

**Pass Criteria:**
- ✅ `state`: `"open"` (circuit tripped)
- ✅ `failures`: ≥10 (threshold met)
- ✅ Next request returns 503 with `X-RateLimit-Reason: circuit_open_global`

**Verify 503:**
```bash
curl -i -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}'

# Should return: 503 Service Unavailable
# Header: X-RateLimit-Reason: circuit_open_global
```

---

## Test 2: Recovery (Half-Open → Closed)

**Objective**: Verify circuit transitions to half-open after cooldown and closes after successful probes

**Wait for Cooldown:**
```bash
echo "Waiting 12s for cooldown..."
sleep 12

# Check state (should be half-open on next request)
curl -s -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
  -o /dev/null

curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global.state'
# Expected: "half_open"
```

**Send Successful Probes:**
```bash
# Send 3 successful requests (probes)
echo "Sending probes..."
for i in {1..3}; do
  curl -s -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
    -o /dev/null
  echo "Probe $i sent"
  sleep 1
done

# Check state (should be closed)
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global | {
  state,
  successes
}'
```

**Pass Criteria:**
- ✅ After cooldown: `state`: `"half_open"`
- ✅ After 3 probes: `state`: `"closed"`
- ✅ `successes`: ≥3
- ✅ Next request succeeds (200)

---

## Test 3: Half-Open Timeout (No Probes)

**Objective**: Verify circuit reopens if no probes arrive within timeout

**Trip Circuit Again:**
```bash
# Generate burst to trip
seq 1 15 | xargs -P 10 -I {} curl -s \
  -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o /dev/null

# Verify open
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global.state'
# Expected: "open"
```

**Wait for Cooldown (Enter Half-Open):**
```bash
sleep 12

# Trigger half-open transition
curl -s -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
  -o /dev/null

curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global | {
  state,
  halfOpenAt: .halfOpenAt
}'
# Expected: state="half_open", halfOpenAt set
```

**Wait for Timeout (No Probes):**
```bash
echo "Waiting 16s for half-open timeout..."
sleep 16

# Next request should observe reopen
curl -i -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}'

# Should return: 503 (circuit reopened)
```

**Verify Metrics:**
```bash
curl -s http://localhost:3000/metrics | grep 'half_open_timeout'
# Should show: plot_engine_circuit_open_total{scope="global",reason="half_open_timeout"}
```

**Pass Criteria:**
- ✅ After timeout: `state`: `"open"` (reopened)
- ✅ Metrics show `reason="half_open_timeout"`
- ✅ Next request returns 503

---

## Test 4: Drip Load (Should NOT Trip)

**Objective**: Verify circuit doesn't trip on low, steady 429 rate

**Reset Circuit:**
```bash
# Wait for cooldown and send successful probes to close
sleep 12
for i in {1..3}; do
  curl -s -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
    -o /dev/null
done

# Verify closed
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global.state'
# Expected: "closed"
```

**Send Drip Load:**
```bash
# 5 failures over 10s (below threshold of 10 in 5s)
echo "Sending drip load..."
for i in {1..5}; do
  curl -s -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{}' \
    -o /dev/null
  sleep 2
done

# Check state (should still be closed)
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.global | {
  state,
  failures
}'
```

**Pass Criteria:**
- ✅ `state`: `"closed"` (did not trip)
- ✅ `failures`: <10 (below threshold)
- ✅ Next request succeeds (200)

---

## Test 5: Per-Principal Isolation

**Objective**: Verify per-principal circuits isolate different clients

**Principal A (Trip):**
```bash
# Send burst from principal A (User-Agent: ClientA)
seq 1 15 | xargs -P 10 -I {} curl -s \
  -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -H "User-Agent: ClientA" \
  -d '{}' \
  -o /dev/null

# Check principal stats
curl -s http://localhost:3000/v1/health | jq '.circuit_breaker.principals | {
  tracked,
  open
}'
```

**Principal B (Should Succeed):**
```bash
# Send request from principal B (User-Agent: ClientB)
curl -i -X POST http://localhost:3000/v1/run \
  -H "Content-Type: application/json" \
  -H "User-Agent: ClientB" \
  -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}'

# Should return: 200 OK (not affected by principal A)
```

**Pass Criteria:**
- ✅ `principals.open`: ≥1 (principal A tripped)
- ✅ Principal B request succeeds (200)
- ✅ Isolation confirmed

---

## Test 6: Performance Impact

**Objective**: Verify breaker adds <1ms p95 latency

**Baseline (Breaker OFF):**
```bash
# Disable breaker
export RL_CB_ENABLE=0
# Restart server

# Measure latency (10 requests)
for i in {1..10}; do
  curl -s -w "%{time_total}\n" -o /dev/null \
    -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}'
done | awk '{sum+=$1; sumsq+=$1*$1} END {print "Avg:", sum/NR, "StdDev:", sqrt(sumsq/NR - (sum/NR)^2)}'
```

**With Breaker (Breaker ON):**
```bash
# Enable breaker
export RL_CB_ENABLE=1
# Restart server

# Measure latency (10 requests)
for i in {1..10}; do
  curl -s -w "%{time_total}\n" -o /dev/null \
    -X POST http://localhost:3000/v1/run \
    -H "Content-Type: application/json" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}'
done | awk '{sum+=$1; sumsq+=$1*$1} END {print "Avg:", sum/NR, "StdDev:", sqrt(sumsq/NR - (sum/NR)^2)}'
```

**Pass Criteria:**
- ✅ Latency increase: <1ms p95
- ✅ No memory leaks (RSS stable)
- ✅ No errors in logs

---

## Summary Checklist

After completing all tests, verify:

- [ ] **Test 1**: Circuit opens on burst (≥threshold failures)
- [ ] **Test 2**: Circuit recovers (half-open → closed after probes)
- [ ] **Test 3**: Half-open timeout reopens circuit
- [ ] **Test 4**: Drip load doesn't trip circuit
- [ ] **Test 5**: Per-principal isolation works
- [ ] **Test 6**: Performance impact <1ms p95

**Metrics Validation:**
```bash
curl -s http://localhost:3000/metrics | grep -E 'circuit_open_total|circuit_probes_total|rate_limit_429_total'
```

Expected:
- `circuit_open_total{scope="global",reason="threshold"}`: >0
- `circuit_open_total{scope="global",reason="half_open_timeout"}`: >0
- `circuit_probes_total{scope="global",result="success"}`: >0

**Health Validation:**
```bash
curl -s http://localhost:3000/v1/health | jq '{
  principal_extraction: .principal_extraction.mode,
  global_state: .circuit_breaker.global.state,
  principals_tracked: .circuit_breaker.principals.tracked
}'
```

Expected:
- `principal_extraction`: `"fallback"`
- `global_state`: `"closed"` (after recovery)
- `principals_tracked`: >0

---

## Troubleshooting

**Circuit doesn't open:**
- Check `RL_CB_FAILURE_THRESHOLD` (lower for testing)
- Verify failures are counted (check `failures` in health)
- Ensure requests are within `RL_CB_WINDOW_MS`

**Circuit doesn't close:**
- Check `RL_CB_HALF_OPEN_PROBES` (lower for testing)
- Verify probes are successful (200 responses)
- Check probe counter in health

**Timeout doesn't trigger:**
- Check `RL_CB_HALF_OPEN_TIMEOUT_MS` (lower for testing)
- Verify circuit is in half-open state
- Wait full timeout duration before sending request

**Per-principal isolation fails:**
- Check `PRINCIPAL_HMAC_SECRET` is set
- Verify `principal_extraction.mode="fallback"`
- Use different User-Agent headers for different principals

---

## Production Readiness Gate

**Pass Criteria (All Must Pass):**
- ✅ All 6 tests pass
- ✅ Metrics show correct reason labels
- ✅ Health shows expected states
- ✅ Performance impact <1ms p95
- ✅ No errors in logs
- ✅ No memory leaks

**If Any Test Fails:**
- Review logs for errors
- Check configuration
- Verify test setup
- Re-run failed test
- Do NOT proceed to production

---

## Next Steps

After successful load test:
1. Document results (timestamp, pass/fail, notes)
2. Update RELEASE_NOTES with test results
3. Proceed to canary deployment (see ALERT_RUNBOOK)
4. Monitor production metrics for 24h
5. Progressive rollout (25% → 50% → 100%)
