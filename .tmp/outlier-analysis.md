# Outlier Run 4 Analysis

## Failure Pattern

**Run 4: 559/588 (15 failures) vs Median: 567/588 (7 failures)**

### Failed Test Categories

1. **Determinism Tests (7 failures)**
   - Same seed → identical model_card
   - Same seed → identical confidence
   - Different seeds → different explain_delta
   - Counterfactual determinism
   - Determinism notes
   - P0 strict determinism (20× runs)

2. **Feature Tests (4 failures)**
   - P1A: debug.compare inclusion
   - P1B: debug.inspector inclusion (2 tests)
   - SCM-Lite disabled warning

3. **Infrastructure Tests (4 failures)**
   - Health counters
   - Inflight plugin
   - Stream backpressure

## Root Cause Hypothesis

**Timing/Race Condition in Server Startup**

Evidence:
- Determinism tests require stable server state
- Feature tests require proper env var propagation
- All failures cluster together (not random)
- Occurs mid-sequence (run 4 of 10)
- Other runs don't show this pattern

**Likely Cause:**
- Server spawn timing issue
- Module cache not fully cleared
- Port binding race condition
- Environment variable propagation delay

## Fix Strategy

1. **Add startup delay** - Ensure server fully ready
2. **Verify port availability** - Check before spawn
3. **Enhanced module reset** - Clear more thoroughly
4. **Startup health check** - Verify server ready before tests

## Implementation

Add to spawnServer utility:
- Wait for health endpoint before returning
- Verify env vars propagated
- Add retry logic for port conflicts
