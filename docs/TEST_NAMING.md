# Test Naming Convention

All test files follow kebab-case naming:

## Format
`{feature}.{aspect}.test.ts`

## Examples
- `adaptive-k.test.ts` - Core adaptive K tests
- `provenance-validation.test.ts` - Provenance schema validation
- `confidence-integer-math.test.ts` - Confidence arithmetic tests
- `ident-tag-integration.test.ts` - Identifiability tag integration
- `whiteboard-features.integration.test.ts` - Multi-feature integration

## Phase-B Test Files
All Phase-B test files created during the fix sprint follow this convention:
- `adaptive-k.test.ts`
- `adaptive-k-sanity.test.ts`
- `provenance.test.ts`
- `provenance-validation.test.ts`
- `confidence-integer-math.test.ts`
- `confidence-determinism.test.ts`
- `ident-tag-integration.test.ts`
- `ident-tag-determinism.test.ts`
- `feature-flag-validation.test.ts`
- `whiteboard-features.integration.test.ts`
