# Roadmap: Functional Priors Implementation

**Date**: 2025-11-15  
**Status**: 🔴 NOT STARTED - Previous attempt failed  
**Target**: v1.7.0 (when actually ready)

---

## Current State

### What Works ✅
- Priors validation (API accepts and validates priors)
- InferenceConfig type extended with priors field
- applyPriorsToGraph utility exists (deterministic, seeded)
- Client-side SDK validation

### What Doesn't Work ❌
- **Priors don't influence inference** - SCM_LITE disabled by default
- **Fallback simulation ignores priors** - Lines 45-53 in model_based.ts
- **No regression tests** - Tests never ran successfully
- **Test pass rate 96.7%** - 15 tests short of 98.5% target

---

## Root Cause Analysis

### Issue 1: Fallback Simulation Ignores Priors

**File**: `src/inference/model_based.ts` (lines 45-53)

```typescript
// Fallback: placeholder simulation
// In production, this should log a warning (handled by caller)
const current_value = baseline_value * 1.15; // Simple placeholder

return {
  conservative: { outcome: baseline_value * 1.05 },
  most_likely: { outcome: current_value },
  optimistic: { outcome: baseline_value * 1.25 },
};
```

**Problem**: 
- No reference to `priors` or `workingGraph`
- Results purely based on `baseline_value`
- `applyPriorsToGraph` is called but output never used

**Why**: Fallback is a placeholder, never intended to support priors

### Issue 2: SCM_LITE Disabled by Default

**File**: `.env.example`

```bash
SCM_LITE_ENABLE=0  # Disabled
```

**Impact**: 
- All requests use fallback simulation
- Priors never influence results
- Users get validation-only behavior

### Issue 3: Tests Never Ran

**File**: `tests/priors-functional.test.ts`

**Error**:
```
TypeError: Failed to parse URL from undefined/v1/run
```

**Problem**:
- `baseUrl` is undefined
- Server never starts in test environment
- All 5 tests fail before assertions

---

## Implementation Plan

### Phase 1: Fix Fallback Simulation (Required)

**Goal**: Make priors work even when SCM_LITE is disabled

**Option A: Implement Priors in Fallback** (Recommended)
```typescript
// Fallback with priors support
run(graph: Graph, config: InferenceConfig): InferenceResult {
  const { seed, baseline_value, priors } = config;
  
  // Apply priors to graph
  const workingGraph = priors ? applyPriorsToGraph(graph, priors, seed) : graph;
  
  // Simple simulation using node values from workingGraph
  // Calculate outcome based on graph structure and node values
  const outcome = this.simulateOutcome(workingGraph, config.outcome_node, baseline_value);
  
  return {
    conservative: { outcome: outcome * 0.95 },
    most_likely: { outcome },
    optimistic: { outcome: outcome * 1.05 },
  };
}

private simulateOutcome(graph: Graph, outcomeNode: string, baseline: number): number {
  // Walk graph from outcome node backwards
  // Use node.value (set by applyPriorsToGraph) to influence calculation
  // Return weighted outcome based on graph structure
}
```

**Option B: Enable SCM_LITE by Default**
```bash
# .env.example
SCM_LITE_ENABLE=1  # Enable by default
```

**Pros**: Priors already work in SCM_LITE path  
**Cons**: Requires SCM_LITE to be production-ready

**Option C: Return Error Without SCM_LITE**
```typescript
if (priors && process.env.SCM_LITE_ENABLE !== '1') {
  throw new Error('Priors require SCM_LITE_ENABLE=1');
}
```

**Pros**: Clear error message  
**Cons**: Feature unavailable by default

**Recommendation**: Option A - Implement priors in fallback

---

### Phase 2: Fix Test Environment

**Goal**: Get priors tests actually running

**Tasks**:

1. **Debug Server Startup**
   ```typescript
   // tests/priors-functional.test.ts
   let server: any;
   let baseUrl: string;
   
   beforeAll(async () => {
     server = await spawnServer();
     baseUrl = `http://localhost:${server.port}`;
     console.log(`Test server started at ${baseUrl}`);
   });
   ```

2. **Add Startup Verification**
   ```typescript
   // Verify server is ready
   const health = await fetch(`${baseUrl}/health`);
   expect(health.status).toBe(200);
   ```

3. **Add Timeout Handling**
   ```typescript
   beforeAll(async () => {
     server = await spawnServer();
     baseUrl = `http://localhost:${server.port}`;
     
     // Wait for server to be ready (max 10s)
     for (let i = 0; i < 100; i++) {
       try {
         const health = await fetch(`${baseUrl}/health`);
         if (health.status === 200) break;
       } catch (e) {
         await new Promise(r => setTimeout(r, 100));
       }
     }
   }, 15000); // 15s timeout
   ```

---

### Phase 3: Write Real Regression Tests

**Goal**: Verify priors actually change results

**Test 1: Priors Change Results**
```typescript
it('priors influence results (regression test)', async () => {
  const graph = {
    nodes: [
      { id: 'demand', label: 'Demand' },
      { id: 'revenue', label: 'Revenue' }
    ],
    edges: [
      { from: 'demand', to: 'revenue' }
    ]
  };

  // Run without priors
  const withoutPriors = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph,
      seed: 4242,
      outcome_node: 'revenue',
      baseline_value: 100
    })
  });
  const resultWithout = await withoutPriors.json();

  // Run with priors
  const withPriors = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph,
      priors: { demand: 0.8 },
      seed: 4242,
      outcome_node: 'revenue',
      baseline_value: 100
    })
  });
  const resultWith = await withPriors.json();

  // CRITICAL: Results must be different
  const withP50 = resultWith.summary.p50;
  const withoutP50 = resultWithout.summary.p50;
  
  expect(withP50).not.toBe(withoutP50);
  expect(Math.abs(withP50 - withoutP50)).toBeGreaterThan(0.01);
  
  // Log for manual verification
  console.log(`Without priors: p50=${withoutP50}`);
  console.log(`With priors (demand=0.8): p50=${withP50}`);
  console.log(`Difference: ${Math.abs(withP50 - withoutP50)}`);
});
```

**Test 2: Determinism with Priors**
```typescript
it('same priors + seed = same results', async () => {
  const request = {
    graph: { nodes: [...], edges: [...] },
    priors: { demand: 0.8 },
    seed: 4242,
    outcome_node: 'revenue',
    baseline_value: 100
  };

  // Run twice with same config
  const run1 = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  const result1 = await run1.json();

  const run2 = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  const result2 = await run2.json();

  // Results must be identical
  expect(result1.summary).toEqual(result2.summary);
  expect(result1.model_card.response_hash).toBe(result2.model_card.response_hash);
});
```

**Test 3: Higher Prior = Higher Outcome**
```typescript
it('higher prior on demand increases revenue outcome', async () => {
  const graph = {
    nodes: [
      { id: 'demand', label: 'Demand' },
      { id: 'revenue', label: 'Revenue' }
    ],
    edges: [
      { from: 'demand', to: 'revenue', weight: 1.0 }
    ]
  };

  // Low prior
  const lowPrior = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph,
      priors: { demand: 0.3 },
      seed: 4242,
      outcome_node: 'revenue',
      baseline_value: 100
    })
  });
  const resultLow = await lowPrior.json();

  // High prior
  const highPrior = await fetch(`${baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph,
      priors: { demand: 0.9 },
      seed: 4242,
      outcome_node: 'revenue',
      baseline_value: 100
    })
  });
  const resultHigh = await highPrior.json();

  // Higher prior should lead to higher outcome
  expect(resultHigh.summary.p50).toBeGreaterThan(resultLow.summary.p50);
  
  console.log(`Low prior (0.3): p50=${resultLow.summary.p50}`);
  console.log(`High prior (0.9): p50=${resultHigh.summary.p50}`);
});
```

---

### Phase 4: Reach 98.5% Pass Rate

**Current**: 789/816 = 96.7%  
**Target**: 804/816 = 98.5%  
**Gap**: 15 tests

**Failing Test Suites**:

1. **Constraints** (6 tests)
   - Feature not implemented
   - Options: Implement or document as future work

2. **SCM-Lite Disabled** (4 tests)
   - Timing-sensitive tests
   - Options: Fix timing or adjust thresholds

3. **Rate Limit** (3 tests)
   - Flaky or environment-specific
   - Options: Fix or stabilize

4. **OpenAPI Examples** (2 tests)
   - Schema mismatches
   - Options: Fix schemas or examples

**Strategy**:
1. Start with easiest fixes (OpenAPI examples)
2. Stabilize rate limit tests
3. Fix or document constraints
4. Address SCM-Lite timing issues

---

## Acceptance Criteria (Real)

### Before v1.7.0 Can Ship

**Functional Requirements**:
- [ ] Priors influence inference results (verified manually)
- [ ] Works with SCM_LITE disabled (fallback supports priors)
- [ ] Deterministic (same priors + seed = same hash)
- [ ] Validation works (invalid priors rejected)

**Test Requirements**:
- [ ] Test environment works (server starts successfully)
- [ ] All 5 priors tests pass
- [ ] Regression tests verify priors change results
- [ ] Pass rate ≥98.5% (804/816 tests)
- [ ] Zero flakes

**Documentation Requirements**:
- [ ] README accurate (priors functional)
- [ ] Release notes complete
- [ ] Examples show priors usage
- [ ] Migration guide (v1.6.0 → v1.7.0)

**Manual Verification**:
- [ ] Smoke test: priors change results
- [ ] Smoke test: determinism verified
- [ ] Smoke test: validation works
- [ ] Performance: priors overhead <5ms

---

## Implementation Checklist

### Phase 1: Fallback Simulation
- [ ] Implement `simulateOutcome()` method
- [ ] Use `workingGraph` (with priors applied)
- [ ] Walk graph structure to calculate outcome
- [ ] Weight by node values (set by priors)
- [ ] Add unit tests for simulation logic

### Phase 2: Test Environment
- [ ] Debug `spawnServer()` in test environment
- [ ] Add startup verification
- [ ] Add timeout handling
- [ ] Verify `baseUrl` is set correctly
- [ ] Run tests and verify they execute

### Phase 3: Regression Tests
- [ ] Test: priors change results
- [ ] Test: determinism with priors
- [ ] Test: higher prior = higher outcome
- [ ] Test: distribution priors work
- [ ] Test: validation errors

### Phase 4: Quality Bar
- [ ] Fix OpenAPI example tests (2)
- [ ] Fix rate limit tests (3)
- [ ] Fix or document constraints (6)
- [ ] Fix SCM-Lite timing tests (4)
- [ ] Verify 98.5% pass rate

### Phase 5: Documentation
- [ ] Update README with functional priors
- [ ] Create RELEASE_NOTES_v1.7.0.md
- [ ] Add examples to docs
- [ ] Update SDK documentation
- [ ] Create migration guide

### Phase 6: Manual Verification
- [ ] Smoke test: run with/without priors
- [ ] Verify results differ
- [ ] Verify determinism
- [ ] Verify validation
- [ ] Check performance

---

## Estimated Effort

### Phase 1: Fallback Simulation
**Effort**: 4-6 hours  
**Complexity**: Medium  
**Risk**: Low (isolated change)

### Phase 2: Test Environment
**Effort**: 2-3 hours  
**Complexity**: Low  
**Risk**: Low (debugging)

### Phase 3: Regression Tests
**Effort**: 2-3 hours  
**Complexity**: Low  
**Risk**: Low (straightforward tests)

### Phase 4: Quality Bar
**Effort**: 6-8 hours  
**Complexity**: Medium-High  
**Risk**: Medium (depends on root causes)

### Phase 5: Documentation
**Effort**: 2-3 hours  
**Complexity**: Low  
**Risk**: Low

### Phase 6: Manual Verification
**Effort**: 1-2 hours  
**Complexity**: Low  
**Risk**: Low

**Total**: 17-25 hours

---

## Risk Assessment

### High Risk
- **Fallback simulation correctness** - Must produce sensible results
- **Test pass rate** - May require significant debugging

### Medium Risk
- **Performance** - Priors overhead must be <5ms
- **Determinism** - Must be stable across runs

### Low Risk
- **Test environment** - Debugging should be straightforward
- **Documentation** - Straightforward once feature works

---

## Success Metrics

### Functional
- ✅ Priors change results (verified in tests)
- ✅ Determinism maintained (same seed = same hash)
- ✅ Works without SCM_LITE (fallback supports priors)

### Quality
- ✅ Pass rate ≥98.5% (804/816 tests)
- ✅ Zero flakes
- ✅ Performance: priors overhead <5ms

### Documentation
- ✅ README accurate
- ✅ Release notes complete
- ✅ Examples provided

---

## Decision Points

### Decision 1: Fallback Implementation Strategy
**Options**: A) Implement priors in fallback, B) Enable SCM_LITE, C) Error without SCM_LITE  
**Recommendation**: Option A  
**Rationale**: Works by default, no dependencies

### Decision 2: Quality Bar Exception
**If** we can't reach 98.5%:
- Document exception with justification
- Get approval from stakeholders
- Set new target date

**Else**: Meet the bar

### Decision 3: Release Timeline
**If** all criteria met: Ship v1.7.0  
**Else**: Stay on v1.6.0, document priors as future work

---

## Next Steps

1. **Start with Phase 1** - Implement priors in fallback simulation
2. **Verify manually** - Test that priors change results
3. **Fix test environment** - Get tests running
4. **Write regression tests** - Verify behavior
5. **Meet quality bar** - Fix failing tests
6. **Ship v1.7.0** - Only when all criteria met

---

**Status**: 🔴 READY TO START - Clear plan, realistic estimates

**Recommendation**: Begin with Phase 1 (fallback simulation) as it's the core blocker
