# Critical Findings: Priors & OpenAPI Mismatches

**Date**: 2025-11-15  
**Severity**: 🔴 HIGH - Breaks API Contract  
**Status**: REQUIRES IMMEDIATE ATTENTION

---

## Summary

Three critical issues discovered in the v1.6.0 implementation:

1. **Priors are validation-only** - Not functionally integrated with inference engine
2. **`/v1/run_bundle` OpenAPI mismatch** - Spec promises fields that aren't returned
3. **`/v1/run_timeslices` OpenAPI mismatch** - Missing evidence support and meta block

---

## Issue 1: Priors - Validation Only (No Inference Integration) 🔴

### Problem
Priors are validated but **never applied to the inference engine**. The feature is functionally inert.

### Evidence

**Validation exists** (src/routes/v1/run.ts:150-169):
```typescript
if (body.priors) {
  const { validatePriors } = await import('../../lib/validate-priors.js');
  const nodeIds = new Set<string>(graph.nodes.map((n: any) => String(n.id)));
  const priorsValidation = validatePriors(body.priors, nodeIds);
  
  if (!priorsValidation.valid) {
    // Returns 400 error
  }
}
// ... but then priors are never used
```

**Inference call doesn't include priors** (src/routes/v1/run.ts:426-431):
```typescript
const inferenceResult = await inferenceEngine.run(graph, {
  seed,
  k_samples,
  outcome_node,
  baseline_value,
  // ❌ No priors parameter
});
```

**InferenceConfig doesn't support priors** (src/inference/types.ts:9-14):
```typescript
export interface InferenceConfig {
  seed: number;
  k_samples: number;
  outcome_node: string;
  baseline_value: number;
  // ❌ No priors field
}
```

### Impact
- API accepts priors but ignores them
- Results are identical with or without priors
- Release notes claim "full priors support" but it's non-functional
- SDK validates priors client-side for a feature that doesn't work server-side

### Affected Endpoints
- `/v1/run` (src/routes/v1/run.ts:150-169)
- `/v1/optimise` (src/routes/v1/optimise.ts:72-82)
- `/v1/run_bundle` (src/routes/v1/run-bundle.ts:85-102)
- `/v1/run_timeslices` (src/routes/v1/run-timeslices.ts:99-116)

### Root Cause
**Design limitation** - The inference engine architecture doesn't support priors. This requires:
1. Extending `InferenceConfig` interface to include priors
2. Modifying both inference engines (`model_based` and `model_of_inference`) to apply priors
3. Implementing prior application logic (how to initialize node beliefs)

This is a **major feature addition**, not just wiring.

### Recommended Fix
**Option A: Complete the feature** (2-3 days)
1. Extend `InferenceConfig` with `priors?: Record<string, number | { mean: number; sd: number }>`
2. Implement prior application in inference engines
3. Add tests for prior-influenced results

**Option B: Document as planned feature** (1 hour)
1. Update release notes to clarify priors are "validated but not yet applied to inference"
2. Mark as "API-ready, inference pending" in v1.6.0
3. Plan for v1.7.0 implementation

**Option C: Remove priors from v1.6.0** (2 hours)
1. Remove validation from all endpoints
2. Remove from OpenAPI spec
3. Remove from SDK
4. Defer to v1.7.0

---

## Issue 2: `/v1/run_bundle` OpenAPI Mismatch 🔴

### Problem
OpenAPI spec promises `model_card` and `evidence` support, but implementation returns different structure.

### OpenAPI Spec (contracts/openapi.yaml:1950-1954)
```yaml
model_card:
  type: object
  properties:
    seed: { type: integer }
    response_hash: { type: string }
```

### Actual Response (src/routes/v1/run-bundle.ts:231-239)
```typescript
return reply.code(200).send({
  schema: 'run_bundle.v1',
  results,
  meta: {  // ❌ Not model_card
    seed,
    total_scenarios: body.deltas.length,
    unique_results: seenHashes.size
    // ❌ No response_hash
  }
});
```

### Impact
- SDK expects `model_card.seed` and `model_card.response_hash`
- Actual response has `meta.seed` (no response_hash)
- Contract tests will fail
- Generated clients will break

### Recommended Fix
**Update response to match OpenAPI** (15 minutes):
```typescript
return reply.code(200).send({
  schema: 'run_bundle.v1',
  results,
  model_card: {
    seed,
    response_hash: bundleHash  // Already computed at line 216
  },
  meta: {
    total_scenarios: body.deltas.length,
    unique_results: seenHashes.size
  }
});
```

---

## Issue 3: `/v1/run_timeslices` OpenAPI Mismatch 🔴

### Problem
OpenAPI spec promises evidence support and `meta.evidence_applied`, but implementation doesn't handle evidence.

### OpenAPI Spec (contracts/openapi.yaml:2000-2009, 2049-2059)
```yaml
# Request
evidence:
  type: array
  items:
    type: object
    required: [node_id, source]

# Response
meta:
  type: object
  properties:
    evidence_applied:
      type: array
```

### Actual Implementation (src/routes/v1/run-timeslices.ts)
```typescript
// ❌ No evidence validation (only priors validated at lines 99-116)
// ❌ No evidence sanitization
// ❌ Response doesn't include meta block (lines 202-210)

return reply.code(200).send({
  schema: 'run_timeslices.v1',
  results,
  model_card: {
    seed,
    response_hash: responseHash,
    timeslices_count: body.timeslices.length
  }
  // ❌ No meta.evidence_applied
});
```

### Impact
- OpenAPI promises evidence support but it's silently ignored
- SDK will send evidence that's never processed
- Response structure doesn't match spec

### Recommended Fix
**Add evidence support** (30 minutes):

1. **Validate evidence** (after priors validation):
```typescript
// After line 116
if (body.evidence) {
  const { validateEvidence } = await import('../../lib/validate-evidence.js');
  const nodeIds = new Set<string>(body.graph.nodes.map((n: any) => String(n.id)));
  const evidenceValidation = validateEvidence(body.evidence, nodeIds);
  
  if (!evidenceValidation.valid) {
    const firstError = evidenceValidation.errors[0];
    return reply.code(400).send({
      error: {
        type: 'BAD_INPUT',
        message: firstError.message,
        field: firstError.field
      }
    });
  }
}
```

2. **Add to audit** (line 186):
```typescript
evidence_count: body.evidence ? body.evidence.length : 0,
```

3. **Update response** (lines 202-210):
```typescript
return reply.code(200).send({
  schema: 'run_timeslices.v1',
  results,
  model_card: {
    seed,
    response_hash: responseHash,
    timeslices_count: body.timeslices.length
  },
  ...(body.evidence && body.evidence.length > 0 && {
    meta: {
      evidence_applied: (await import('../../lib/validate-evidence.js')).sanitizeEvidence(body.evidence)
    }
  })
});
```

---

## Priority & Timeline

### Immediate (Must fix before v1.6.0 release)
1. ✅ **Fix `/v1/run_bundle` response structure** (15 min)
2. ✅ **Add evidence support to `/v1/run_timeslices`** (30 min)
3. ✅ **Document priors limitation** (1 hour)

### Short-term (v1.6.1 patch)
4. **Implement functional priors** or **remove from API** (2-3 days or 2 hours)

### Total Time to Fix Critical Issues
- **Minimum**: 1.75 hours (fix OpenAPI mismatches + document priors)
- **Complete**: 2-3 days (implement functional priors)

---

## Acceptance Criteria

### Before v1.6.0 Release
- [ ] `/v1/run_bundle` response matches OpenAPI spec
- [ ] `/v1/run_timeslices` supports evidence with sanitized echo
- [ ] Priors limitation documented in release notes
- [ ] All OpenAPI round-trip tests passing
- [ ] SDK updated if response structures change

### For v1.7.0 (Functional Priors)
- [ ] `InferenceConfig` extended with priors
- [ ] Inference engines apply priors to node beliefs
- [ ] Tests verify priors influence results
- [ ] Documentation updated to remove "validation-only" caveat

---

## Recommendation

**For v1.6.0 Release:**
1. Fix the two OpenAPI mismatches (45 minutes)
2. Document priors as "API-ready, inference pending" (1 hour)
3. Plan priors implementation for v1.7.0

**Alternative (More Honest):**
1. Fix OpenAPI mismatches (45 minutes)
2. Remove priors from v1.6.0 entirely (2 hours)
3. Re-introduce in v1.7.0 with full implementation

---

**Status**: 🔴 BLOCKING v1.6.0 RELEASE - Requires immediate fix
