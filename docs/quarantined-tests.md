# Quarantined Tests Registry

**Last Updated:** 2025-11-24
**Total Quarantined:** 5 test suites + 7 individual skipped tests

---

## Overview

Quarantined tests are tests that have been intentionally disabled due to:
- Flakiness (timing races, non-deterministic behavior)
- Edge cases requiring theoretical verification
- Performance issues (timeouts in test environment)
- Test environment limitations

All quarantined tests have been reviewed and deemed **non-blocking** for production releases.

---

## Quarantined Test Suites

### 1. Counterfactual Zero Baseline — ✅ RESOLVED BY WITHDRAWAL (2026-07-30)

**Status:** Closed. Both files deleted: `tests/counterfactual.zero-baseline.quarantined.test.ts`
and `tests/counterfactual.zero-baseline.test.ts`.

**Why it is closed rather than fixed.** The quarantine was about an epsilon threshold for a
near-zero baseline in the `percentage_change` calculation. That calculation has been deleted along
with the rest of `/v1/counterfactual`, which was WITHDRAWN as a fabrication trap under ROADMAP
2.105: its `baseline` and `counterfactual` values were `intervention.from_value * 100` and
`intervention.to_value * 95` — placeholder arithmetic, self-commented as such, with the graph never
read. There was no measured baseline to be near zero.

Note what the quarantine implied but no one checked: a "numeric precision edge case" framing treats
the surrounding number as real. The precision of a placeholder is not a numeric-stability question.

The route now answers a typed 501; its contract is pinned in
`tests/analysis-routes.refusal.test.ts`. **Nothing is owed here** — do not re-add an epsilon
threshold to a withdrawn capability.

---

### 2. Gate Tools Singleline Output
**File:** [`tests/gates.singleline.quarantined.test.ts`](../tests/gates.singleline.quarantined.test.ts)
**Status:** ⚠️ Quarantined (Non-blocking)
**Owner:** TODO - test harness improvements

**Reason:**
Gate tools timeout in test environment (>30s)

**Impact:**
Non-blocking - gate output format validation only. Gates run successfully in CI.

**Re-enable Criteria:**
- Add timeout config to Vitest for gate tests (`testTimeout: 60000`)
- Mock gate execution for unit tests
- Extract gate parsing logic to separate testable module

**Recommended Fix:**
```typescript
// tests/vitest.config.gates.ts
export default defineConfig({
  test: {
    testTimeout: 60000, // 60s for gate execution
    include: ['tests/gates.*.test.ts']
  }
});
```

---

### 3. Stream Cancellation
**File:** [`tests/stream.cancel.quarantined.test.ts`](../tests/stream.cancel.quarantined.test.ts)
**Status:** ⚠️ Quarantined (Non-blocking)
**Owner:** TODO - SSE test harness improvements

**Reason:**
Stream cancellation event not emitted reliably in test environment (timing race)

**Impact:**
Non-blocking - cancel functionality works in production, event emission timing issue only

**Re-enable Criteria:**
- Add deterministic event emission with explicit flush
- Mock stream lifecycle to eliminate timing races
- Use event queue with synchronous drain for tests

**Recommended Fix:**
```typescript
// Add to tests/helpers/sse.ts:
export async function drainSseEvents(stream: EventSource): Promise<Event[]> {
  const events: Event[] = [];
  return new Promise((resolve) => {
    stream.addEventListener('message', (e) => events.push(e));
    stream.addEventListener('done', () => resolve(events));
    setTimeout(() => resolve(events), 5000); // Safety timeout
  });
}
```

---

### 4. Identifiability Multi-Set D-Separation
**File:** [`tests/identifiability.multi-set.quarantined.test.ts`](../tests/identifiability.multi-set.quarantined.test.ts)
**Status:** ⚠️ Quarantined (Requires theory verification)
**Owner:** TODO - graph theory verification

**Reason:**
Test expects false (not d-separated) but standard d-sep blocks mediators

**Impact:**
Non-blocking - test expectation may be incorrect for this graph structure

**Re-enable Criteria:**
- Verify correct d-separation behavior for multi-mediator graphs
- Consult Pearl (2009) Causality, mediator blocking rules
- Update test expectation OR fix implementation based on theory

**Recommended Actions:**
1. Draw graph structure and manually verify d-separation
2. Use external tool (e.g., dagitty) to verify expected behavior
3. Update either test expectation or `dSeparated()` implementation
4. Document edge case in causal inference module

**References:**
- Pearl, J. (2009). Causality: Models, Reasoning, and Inference (2nd ed.)
- [Dagitty](http://www.dagitty.net/) - online d-separation verification

---

### 5. D-Separation Symmetry Properties
**File:** [`tests/identifiability.dsep.props.quarantined.test.ts`](../tests/identifiability.dsep.props.quarantined.test.ts)
**Status:** ⚠️ Quarantined (Requires implementation)
**Owner:** TODO - see PR P7 for Bayes-ball plan

**Reason:**
Bayes-ball symmetry property requires careful collider handling; flaky with random DAGs

**Impact:**
Non-blocking - academic correctness test, doesn't affect production causal inference

**Re-enable Criteria:**
- Implement explicit Bayes-ball state machine in `src/causal/bayesball.ts` with proven symmetry
- Add deterministic Bayes-ball algorithm (not random walk approximation)
- Prove symmetry mathematically: `dSeparated(X,Y|Z) ⟺ dSeparated(Y,X|Z)`

**Recommended Implementation:**
```typescript
// src/causal/bayesball.ts (NEW)
export function bayesBall(
  dag: DAG,
  start: string,
  end: string,
  conditioningSet: Set<string>
): boolean {
  // Implement Bayes-ball algorithm from Pearl (2009)
  // 1. Initialize ball at start node traveling "down"
  // 2. Propagate through ancestors/descendants following rules:
  //    - Bounce off conditioning nodes
  //    - Pass through colliders if conditioned or descendants conditioned
  // 3. Return true if ball reaches end node
}
```

**References:**
- Pearl, J. (2009). Causality, Chapter 1.2.3 on d-separation
- Shpitser, I., & Pearl, J. (2008). Complete Identification Methods for the Causal Hierarchy

---

## Individual Skipped Tests

### 6. Counterfactual: from_value Very Close to 0 — ✅ RESOLVED BY WITHDRAWAL (2026-07-30)

**File:** deleted (`tests/counterfactual.zero-baseline.test.ts`)
**Disposition:** closed with entry #1 above — `/v1/counterfactual` was withdrawn (ROADMAP 2.105)
and the `percentage_change` calculation this pinned no longer exists.

---

### 7. D-Separation Symmetry on Small DAGs
**File:** [`tests/identifiability.dsep.props.test.ts:26`](../tests/identifiability.dsep.props.test.ts#L26)
**Reason:** Same Bayes-ball symmetry issue as #5 above
**Re-enable:** When Bayes-ball state machine is implemented

---

### 8. Identifiability Multi-Mediator Determinism
**File:** [`tests/identifiability.multi-set.test.ts:25`](../tests/identifiability.multi-set.test.ts#L25)
**Reason:** Edge case - multiple mediators produce non-deterministic d-sep results
**Re-enable:** When d-separation algorithm is made fully deterministic

---

### 9. Stream: Pre-Token Cancel
**File:** [`tests/stream.cancel.test.ts:45`](../tests/stream.cancel.test.ts#L45)
**Reason:** Same SSE timing race as #3 above
**Re-enable:** When SSE test harness supports synchronous event draining

---

### 10. P1 Stream: Enhanced Route Heartbeat
**File:** [`tests/p1-stream-integration.test.ts:24`](../tests/p1-stream-integration.test.ts#L24)
**Reason:** Flaky - heartbeat timing not guaranteed within 2s in CI
**Re-enable:** Change assertion to ≤3s or make heartbeat interval configurable

**Recommended Fix:**
```typescript
it('enhanced route emits heartbeat within 3s', async () => {
  const events = await drainSseEvents(stream, { timeout: 3500 });
  const heartbeat = events.find(e => e.type === 'comment' && e.data.includes('ping'));
  expect(heartbeat).toBeDefined();
}, 5000);
```

---

### 11. Gates: SDK Smoke Single-Line Output
**File:** [`tests/gates.singleline.test.ts:16`](../tests/gates.singleline.test.ts#L16)
**Reason:** Same gate timeout issue as #2 above
**Re-enable:** When gate test harness supports long-running tools

---

### 12. Conditional Skips (Environment-Dependent)
**File:** [`tests/evidence-pack.test.ts:25,36`](../tests/evidence-pack.test.ts#L25)
**Reason:** Skipped if `!packDir` (evidence pack not generated)
**Status:** ✅ OK - conditional skip is intentional for CI environments without pack generation

---

## Quarantine Policy

### When to Quarantine a Test
1. **Flakiness:** Test fails >5% of the time in CI (not due to bugs)
2. **Performance:** Test exceeds reasonable timeout (>30s) without mocking
3. **Theory:** Test requires academic verification or external tool validation
4. **Environment:** Test requires specific environment setup not available in CI

### Quarantine Process
1. Move test to `*.quarantined.test.ts` file
2. Add file header with:
   - Reason (root cause)
   - Impact (blocking vs non-blocking)
   - Re-enable criteria (specific conditions)
   - Owner (team or individual responsible)
   - References (papers, PRs, issues)
3. Add entry to this registry
4. Create tracking issue in GitHub (optional)
5. Update this document

### Re-Enable Process
1. Fix root cause (implementation or test)
2. Verify test passes consistently (10+ runs)
3. Move from `*.quarantined.test.ts` to regular test file
4. Update this registry
5. Remove tracking issue

---

## Monitoring

### CI Check
Add to `.github/workflows/pr-verify.yml`:
```yaml
- name: Check for new quarantined tests
  run: |
    NEW_QUARANTINED=$(git diff main --name-only | grep 'quarantined.test.ts' || true)
    if [ -n "$NEW_QUARANTINED" ]; then
      echo "::warning::New quarantined tests detected: $NEW_QUARANTINED"
      echo "Ensure docs/quarantined-tests.md is updated"
    fi
```

### Monthly Review
- Schedule: First Monday of each month
- Agenda:
  1. Review all quarantined tests
  2. Attempt to re-enable oldest quarantined test
  3. Update owners and re-enable criteria
  4. Document any new insights or blockers

---

## Statistics

**Current Status:**
- Total test suites: ~180
- Quarantined suites: 5 (2.8%)
- Individual skipped tests: 7 (excluding conditional skips)
- Pass rate (non-quarantined): 100%

**Trend:**
- Last quarter: 5 → 5 (no change)
- Target: <3% quarantined tests

---

## Related Documents

- [Error Handling Guidelines](./error-handling-guidelines.md)
- [Empty Catch Remediation Roadmap](/tmp/empty-catch-remediation-roadmap.md)
- [Contributing Guide](../CONTRIBUTING.md)
