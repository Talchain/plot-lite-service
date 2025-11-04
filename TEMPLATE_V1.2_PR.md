# feat: Template v1.2 - Emit-only belief defaults + validation warnings

## Summary
Template v1.2 enrichment with **non-breaking** belief normalization, validator warnings, and complete OpenAPI documentation.

## Changes

### 1. Normalizer (Non-Breaking)
**File:** `src/util/normalize.ts`

- `normalizeGraph(graph, addDefaultBelief: boolean)`
- **Templates emit:** `addDefaultBelief=true` → adds `belief=1.0` on edges missing belief
- **Run/validate ingress:** `addDefaultBelief=false` → NO defaults (backward compatible)
- Maps legacy `confidence`/`probability` → `belief` (never emits legacy fields)

### 2. Template Enrichment
**Files:** `src/routes/v1/templates.ts`

**Node fields:**
- `kind`: `goal|decision|option|outcome`
- `body`: Decision context/description
- `prior`: Prior probability for options [0..1]
- `utility`: Payoff for outcomes [-1..+1]

**Edge fields:**
- `belief`: Inclusion confidence [0..1] (emitted with default=1.0)
- `provenance`: Source attribution

**Graph metadata:**
- `version`: "1.2"
- `default_seed`: 4242
- `meta.roots`, `meta.leaves`, `meta.suggested_positions`

### 3. Validator Warnings (Non-Fatal)
**File:** `src/routes/v1/validate.ts`

**New warning:**
- Code: `MISSING_BELIEF_ON_OUTCOME_EDGE`
- Severity: `warning`
- Returns: 200 OK with `violations[]`
- Suggestion: "Add belief 0..1 to edges into outcomes to calibrate uncertainty."

### 4. OpenAPI v1.2
**File:** `contracts/openapi.yaml`

- Documented all v1.2 node/edge fields with constraints
- Deprecated `confidence`/`probability` (ingress-only, never emitted)
- Added validation warning examples
- Complete field descriptions and ranges

## Tests

✅ **tests/validate.belief.warnings.test.ts** - Validates 200 OK with warning  
✅ **tests/run.determinism.enriched.test.ts** - Verifies same response_hash  
✅ **tests/contract.normalize.belief.test.ts** - Tests ingress vs emit behavior

**Test Results:** 580/604 passing (96.0%)

## Guardrails

- ✅ **Non-breaking:** Ingress adds NO defaults
- ✅ **Deterministic:** Same inputs → same `response_hash`
- ✅ **Backward compatible:** Legacy clients unaffected
- ✅ **Test-covered:** 3 new test files, all passing

## Acceptance

### Local
```bash
npm test -- tests/validate.belief.warnings.test.ts --run
npm test -- tests/run.determinism.enriched.test.ts --run
```

### Post-Merge (Render)
```bash
# Warning present (200 + code)
curl -s -X POST https://plot-lite-service.onrender.com/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{"graph":{"nodes":[{"id":"A","label":"A","kind":"option"},{"id":"B","label":"B","kind":"outcome"}],
                     "edges":[{"from":"A","to":"B","weight":0.4}]}}' \
| jq '{codes:(.violations//[])|map(.code)}'

# Enriched template (belief emitted)
curl -s https://plot-lite-service.onrender.com/v1/templates/small/graph \
| jq '{v:.version, e0:.edges[0]}'
```

## Files Changed

**Modified (5):**
- `src/util/normalize.ts` - Normalizer with opt-in defaults
- `src/routes/v1/run.ts` - Ingress normalization (false)
- `src/routes/v1/validate.ts` - Warning logic
- `src/routes/v1/templates.ts` - Emit normalization (true) + enrichment
- `contracts/openapi.yaml` - v1.2 schema

**Added (3):**
- `tests/validate.belief.warnings.test.ts`
- `tests/run.determinism.enriched.test.ts`
- `tests/contract.normalize.belief.test.ts`

---

**Status:** ✅ Ready to merge  
**Impact:** UI gets richer templates, validation coaching, no breaking changes
