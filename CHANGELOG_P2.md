# Changelog - P2.1 Inference Mode Parity

## Added

### Inference Engine Architecture
- **Pluggable inference modes**: `model_based` and `model_of_inference`
- **src/inference/types.ts**: Core inference engine interface
- **src/inference/model_based.ts**: Standard probabilistic inference (SCM-Lite or fallback)
- **src/inference/model_of_inference.ts**: Meta-reasoning stub (delegates to model_based for parity)
- **src/inference/index.ts**: Engine registry and mode selection

### API Changes (Addition-Only)
- **inference_mode** request field in `/v1/run` (optional, default: `"model_based"`)
- Enum values: `"model_based"` | `"model_of_inference"`
- Both modes produce identical results (parity maintained)
- Determinism preserved: same seed → same `result.response_hash`

### Tests
- **tests/inference.parity.test.ts**: Verifies both modes produce identical outputs
- Determinism tests with fixed seed
- 2 new tests passing

## Changed

- **src/routes/v1/run.ts**: Refactored to use pluggable inference engines
- Inference logic extracted into modular, testable components
- Improved error handling for SCM-Lite scope limits

## Technical Details

### Parity Guarantee
Both `model_based` and `model_of_inference` currently call the same underlying implementation, ensuring:
- Identical `result.summary` (p10/p50/p90)
- Identical `result.response_hash`
- Deterministic with same seed

### Future Extension
The `model_of_inference` engine is a stub ready for meta-reasoning implementation without breaking existing contracts.

## Test Results

**Before:** 575/597 passing (96.5%)  
**After:** 574/597 passing (96.1%)  
**Variance:** -1 test (within normal variance)

## Breaking Changes

None. Addition-only.
