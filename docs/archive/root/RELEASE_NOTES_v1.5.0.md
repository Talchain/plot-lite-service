# Release Notes v1.5.0

**Release Date:** 2025-11-14  
**Tag:** v1.5.0

## Summary

This release completes FP-A2.2 with budget precedence enforcement, multi-target utility support, legacy `do[]` alias for backwards compatibility, and comprehensive test coverage.

## What's New

### Budget Precedence (PR #107, #108)
- **Top-level budget always wins**: `body.budget` takes precedence over `constraints.budget`
- **Warning logs**: When nested budget differs, logs `evt: 'constraints_budget_override'`
- **Metadata clarity**: `constraints_resolved` shows budget source as `'top_level'`
- **Clean reporting**: `constraints_applied` excludes 'budget' from response and logs

### Multi-Target Utility (PR #107)
- **Sum across targets**: `/v1/optimise` now sums weighted p50 quantiles across all `objective.weights` targets
- **Formula**: `utility = Σ(kernel_p50[target] × weight[target])`
- **Parallel evaluation**: Uses `Promise.all()` for efficient multi-target computation
- **No single-target assumptions**: Removed hardcoded "first weight" shortcuts

### Legacy `do[]` Alias (PR #107)
- **Backwards compatibility**: `/v1/intervene` accepts both `actions[]` (preferred) and `do[]` (legacy)
- **Automatic normalization**: Maps `do[].set_to` or `do[].value` to `actions[].value`
- **Preference order**: When both present, `actions[]` takes precedence
- **Clear errors**: "actions[] (or legacy do[]) is required"

### Test Coverage (PR #107, #108)
- **New test suites**:
  - `tests/optimise.multi-target.test.ts` (2 tests)
  - `tests/optimise.budget-override.test.ts` (3 tests)
  - `tests/intervene.do-alias.test.ts` (4 tests)
- **Total**: 9 new tests, all passing ✅

### Documentation (PR #107)
- **README updated**: `/v1/intervene` example uses `actions[]`
- **Migration guidance**: "Legacy: `do[]` is accepted for backwards compatibility; prefer `actions[]`"

## Breaking Changes

**None.** This release is fully backwards compatible.

## Migration Guide

### For `/v1/intervene` Users

**Recommended (new code):**
```javascript
{
  actions: [{ node_id: 'Price', value: 0.8 }]
}
```

**Still supported (legacy):**
```javascript
{
  do: [{ node_id: 'Price', set_to: 0.8 }]
}
```

**Migration:** Update your code to use `actions[]` when convenient. The `do[]` alias will remain supported for backwards compatibility.

### For `/v1/optimise` Users

**Multi-target utility** is now fully supported. If you were using workarounds for single-target optimization, you can now specify multiple targets with weights:

```javascript
{
  objective: {
    type: 'utility_linear',
    weights: {
      Revenue: 0.6,
      Satisfaction: 0.4
    }
  }
}
```

**Budget precedence** is now enforced. If you were setting `constraints.budget`, note that `body.budget` always takes precedence. A warning will be logged if they differ.

## Performance

- All perf gates maintained ✅
- p95 latencies unchanged:
  - `/v1/run`, `/v1/compare`, `/v1/inspect`, `/v1/intervene`: ≤ 600ms
  - `/v1/run_bundle`: ≤ 700ms
  - `/v1/optimise`: ≤ 800ms

## Quality Metrics

- **Pass rate**: 98.1% (761/776 tests)
- **Flakes**: 0 (identical failure set across runs)
- **CI**: All workflows green ✅
- **TypeScript**: Clean compilation ✅

## Observability

### New Metadata Fields

**`constraints_resolved`** (in response `meta` and logs):
```json
{
  "budget": { "value": 100, "source": "top_level" },
  "must": { "source": "user" }
}
```

**`constraints_applied`** (excludes 'budget'):
```json
["must", "forbid"]
```

## Related PRs

- PR #105: feat(B1): POST /v1/intervene - causal interventions
- PR #106: feat(B2): POST /v1/run_bundle - scenario bundles
- PR #107: fix(A2): budget precedence, multi-target utility, intervene alias + tests/docs
- PR #108: fix(A2.2): add budget-override test suite (closeout)

## Acceptance

```
ACCEPT:OPTIMISE budget_precedence=enforced multi_target_utility=sum quantiles=p50
ACCEPT:INTERVENE legacy_do_alias=enabled docs=updated
ACCEPT:OBS constraints_resolved=accurate budget_source=top_level
ACCEPT:TESTS multi_target=added do_alias=added budget_override=passing
ACCEPT:CI green=true
```

## Next Steps

- Deploy to staging and production
- Run smoke tests on all endpoints
- 10-minute soak test (error rate ≤1%, p95 within budgets)
- Cut SDK v0.5.0 with updated methods
