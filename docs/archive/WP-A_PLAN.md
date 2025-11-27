# Work Package A: Interventions & Constraints

**Status:** Ready to start  
**Dependencies:** v1.4.0 released ✅  
**Target:** User-visible value through causal interventions and constraint enforcement

---

## A1: /v1/intervene (do-operator)

### Requirements

- **Endpoint:** POST /v1/intervene
- **Request schema:**
  ```typescript
  {
    graph: { nodes, edges },
    actions: [{ node_id: string, value: number }],
    seed?: number
  }
  ```
- **Semantics:** Enforce do(value) - hard set node values, breaking incoming edges
- **Response:** Include baseline, counterfactual, delta (similar to compare)
- **Determinism:** Hash must include actions array
- **SCM-Lite aware:** Respect causal structure when applying interventions

### Tests Required

1. Confounding blocked (intervention breaks backdoor paths)
2. Equality vs equivalent graph edit (do-operator semantics)
3. SCM-Lite mode compatibility
4. Determinism (same seed + actions → same hash)
5. Multiple simultaneous interventions
6. Invalid node_id rejection

### Files to Create/Modify

- `src/routes/v1/intervene.ts` (already exists, needs do-operator semantics)
- `tests/intervene-do-operator.test.ts` (new)
- `contracts/openapi.yaml` (update intervene schema)
- `packages/olumi-plot-sdk/src/index.ts` (update intervene function)

### Acceptance Criteria

- ✅ /v1/intervene returns intervene.v1 with do-operator semantics
- ✅ Deterministic hashing includes actions
- ✅ Tests pass: confounding, equivalence, SCM-Lite
- ✅ OpenAPI + SDK parity
- ✅ Performance: p95 ≤ 600ms

---

## A2: Feasibility & Constraints

### Requirements

- **Constraint types:**
  - `budget`: Total cost limit for actions
  - `must`: Required actions (must be included)
  - `must_not`: Forbidden actions
  - `max_changed_nodes`: Limit on number of interventions
  
- **Endpoints affected:**
  - `/v1/optimise` - Respect constraints during action selection
  - `/v1/intervene` - Validate constraints before execution
  
- **Infeasibility handling:**
  ```typescript
  {
    error: {
      type: "INFEASIBLE",
      message: "Constraints cannot be satisfied",
      violations: [
        { constraint: "budget", required: 100, available: 80 },
        { constraint: "must", action: "hire_sales", reason: "exceeds_budget" }
      ]
    }
  }
  ```

### Tests Required

1. Budget constraint enforcement
2. Must/must_not action validation
3. Max changed nodes limit
4. Infeasible plan detection with minimal hitting set
5. Constraint combinations (budget + must)
6. Edge cases (empty constraints, conflicting must/must_not)

### Files to Create/Modify

- `src/engine/constraints.ts` (new - constraint validation logic)
- `src/routes/v1/optimise.ts` (update with constraint handling)
- `src/routes/v1/intervene.ts` (add constraint validation)
- `tests/constraints-feasibility.test.ts` (new)
- `contracts/openapi.yaml` (add constraint schemas)
- `packages/olumi-plot-sdk/src/index.ts` (update types)

### Acceptance Criteria

- ✅ Optimiser respects all constraint types
- ✅ Infeasible plans return structured violations
- ✅ Minimal hitting set for conflict resolution
- ✅ OpenAPI + SDK parity
- ✅ Tests: ≥98.5% pass rate
- ✅ Performance: p95 ≤ 600ms (unaffected)

---

## Implementation Order

1. **A1.1:** Update `/v1/intervene` with do-operator semantics
2. **A1.2:** Add deterministic hashing for actions
3. **A1.3:** Write tests for confounding and equivalence
4. **A1.4:** Update OpenAPI and SDK
5. **A2.1:** Create constraint validation engine
6. **A2.2:** Integrate constraints into `/v1/optimise`
7. **A2.3:** Add infeasibility detection
8. **A2.4:** Update OpenAPI and SDK
9. **A2.5:** Comprehensive constraint tests

---

## Performance Budget

- `/v1/intervene`: p95 ≤ 600ms (same as /v1/run)
- `/v1/optimise`: p95 ≤ 800ms (allows for constraint checking)
- Constraint validation: O(n) where n = number of actions

---

## Risks & Mitigations

**Risk:** Do-operator semantics may be complex for users  
**Mitigation:** Clear documentation with examples, SDK helper functions

**Risk:** Constraint solving may be computationally expensive  
**Mitigation:** Simple greedy approach first, optimize if needed

**Risk:** Infeasibility messages may be unclear  
**Mitigation:** Structured violations with actionable guidance

---

## Success Metrics

- All tests pass (≥98.5%)
- Performance gates pass (p95 ≤ 600ms)
- OpenAPI documentation complete
- SDK functions working with examples
- Zero breaking changes to existing endpoints

---

## Next Steps After WP-A

Proceed to WP-B: Timeslices & Scenario Bundles
