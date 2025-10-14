# SCM-Lite Technical Notes

**Version**: 1.0  
**Status**: Production-ready (flagged OFF by default)  
**Performance**: p95 = 3.25ms for 12-node graphs (185x under 600ms budget)

---

## Overview

SCM-Lite is a lightweight structural causal model approximation engine that provides deterministic, explainable quantile estimates for small directed acyclic graphs (DAGs). It uses edge masking with Bayesian model averaging to handle uncertainty in causal structure.

### Why "Lite"?

SCM-Lite is optimized for:
- **Small graphs**: ≤12 nodes (hard cap)
- **Fast inference**: <5ms p95 for typical graphs
- **Determinism**: Same input+seed → identical outputs
- **Explainability**: Transparent edge masking and quantile computation

It is **not** a full structural causal model implementation. It does not:
- Perform causal discovery or structure learning
- Handle continuous interventions or counterfactuals
- Support non-linear relationships or latent confounders
- Provide formal identifiability proofs

---

## Architecture

### Core Components

1. **Deterministic RNG** (`src/scm-lite/rng.ts`)
   - XorShift128+ algorithm
   - Seeded for reproducibility
   - Jump function for parallel streams

2. **Kernel** (`src/scm-lite/kernel.ts`)
   - Edge masking with Bernoulli sampling
   - Topological sort for stable ordering
   - Linear forward pass through DAG
   - Quantile computation (p10/p50/p90)
   - BMA hash over canonical sample buffer

3. **Adapter** (`src/scm-lite/adapter.ts`)
   - Maps trust Graph to SCM DAG
   - Adapts kernel results to report.v1 format
   - Preserves contract stability

---

## Edge Masking Rationale

### Problem
Real-world causal graphs often have uncertain edges. Traditional SCM assumes known structure, but practitioners face:
- Expert disagreement on edge existence
- Weak empirical evidence for some relationships
- Need to quantify structural uncertainty

### Solution: Bayesian Model Averaging
For each edge with belief probability `p ∈ [0,1]`:
1. Sample K edge masks (Bernoulli trials)
2. Run forward pass on each masked graph
3. Aggregate outcomes to compute quantiles
4. Confidence reflects mask diversity and sign stability

### Example
```
Graph: A → B → C
Edge beliefs: A→B (0.8), B→C (0.9)

K=100 samples:
- 72 samples: both edges present
- 18 samples: only A→B present
- 8 samples: only B→C present
- 2 samples: no edges present

Quantiles computed over all 100 outcomes.
```

---

## Deterministic RNG

### Why XorShift128+?
- **Fast**: ~2ns per call (vs ~20ns for Math.random)
- **Deterministic**: Same seed → same sequence
- **Quality**: Passes BigCrush statistical tests
- **Portable**: Pure JavaScript, no platform dependencies

### Seed Handling
```typescript
const rng = new XorShift128Plus(seed);
for (let k = 0; k < K; k++) {
  const mask = sampleEdgeMask(dag, rng, beliefDefault);
  // ... forward pass
}
```

All randomness flows through the seeded RNG, ensuring:
- **10/10 identical hashes** with same seed (verified in tests)
- **Reproducible debugging** (replay with same seed)
- **Audit trails** (seed logged in model_card)

---

## Quantiles & Confidence

### Quantile Computation
```typescript
samples.sort((a, b) => a - b);
const p10 = samples[Math.floor(K * 0.1)];
const p50 = samples[Math.floor(K * 0.5)];
const p90 = samples[Math.floor(K * 0.9)];
```

Maps to results format:
- `conservative` = p10
- `most_likely` = p50
- `optimistic` = p90

### Confidence Heuristic
```typescript
score = diversity * 0.3 + signStability * 0.5 + pathCoverage * 0.2

if (score >= 0.7) → HIGH
if (score >= 0.4) → MEDIUM
else → LOW
```

**Factors**:
- **Diversity**: unique_graphs / K (structural variation)
- **Sign Stability**: max(pos, neg) / K (directional consistency)
- **Path Coverage**: identified_paths / 10 (graph connectivity)

---

## BMA Hash

### Purpose
Cryptographic fingerprint of the K-wise sample distribution, enabling:
- **Determinism verification**: Same seed → same hash
- **Audit trails**: Hash logged in model_card
- **Regression detection**: Hash changes signal drift

### Computation
```typescript
const canonical = samples.map(s => s.toFixed(6)).join(',');
const bma_hash = sha256(canonical);
```

**Properties**:
- **Stable**: Invariant to sample order (sorted)
- **Sensitive**: Single sample change → different hash
- **Compact**: 64 hex chars (32 bytes)

---

## Performance Characteristics

### Complexity
- **Time**: O(N + E×K) where N=nodes, E=edges, K=samples
- **Space**: O(N + E + K)

### Benchmarks (CI runner)
| Graph Size | K   | p50   | p95   | Budget |
|-----------|-----|-------|-------|--------|
| 4 nodes   | 100 | 0.2ms | 0.2ms | 50ms   |
| 12 nodes  | 256 | 2.1ms | 3.3ms | 600ms  |

**Margin**: 185x under budget for 12-node graphs

### Bottlenecks
1. **Edge loop** (K iterations): 60% of time
2. **Topological sort**: 20% of time
3. **Quantile selection**: 10% of time
4. **Hash computation**: 10% of time

---

## Configuration

### Environment Variables
```bash
SCM_LITE_ENABLE=0           # Feature flag (default OFF)
SCM_LITE_K=256              # Edge mask samples (10-10000)
SCM_LITE_MAX_NODES=12       # Hard node cap (2-50)
SCM_LITE_BELIEF_DEFAULT=0.7 # Default edge belief (0-1)
```

### Validation
All env vars validated at startup in `src/config-validator.ts`:
- K: 10 ≤ K ≤ 10000
- MAX_NODES: 2 ≤ N ≤ 50
- BELIEF_DEFAULT: 0 ≤ p ≤ 1

---

## Limitations

### Hard Constraints
- **Graph size**: ≤12 nodes (enforced)
- **Acyclic**: Cycles rejected at runtime
- **Linear**: Forward pass assumes linear aggregation

### Known Issues
1. **No latent confounders**: All confounders must be observed
2. **No feedback loops**: DAG assumption (no cycles)
3. **No time-varying effects**: Static structure only
4. **Belief homogeneity**: Single default belief for all edges

### Future Work
- Adaptive K based on graph complexity
- Non-linear aggregation functions
- Parallel edge mask sampling
- Incremental updates for graph edits

---

## Integration with /v1/run

### Flag-Gated Execution
```typescript
if (process.env.SCM_LITE_ENABLE === '1') {
  const scmResult = runSCMLite(graph, outcome_node, config);
  // Map to report.v1 format
  results = {
    conservative: { outcome: scmResult.summary.bands.p10 },
    most_likely: { outcome: scmResult.summary.bands.p50 },
    optimistic: { outcome: scmResult.summary.bands.p90 },
  };
  confidence = adaptConfidence(scmResult.confidence);
  base.model_card.bma_hash = scmResult.bma_hash;
}
```

### Contract Preservation
- **No schema changes**: report.v1 fields unchanged
- **Backward compatible**: Flag OFF → original behavior
- **Deterministic**: response_hash stable with same seed

---

## Testing Strategy

### Golden Tests (`tests/scm-lite/kernel.golden.test.ts`)
- 3 reference graphs (chain, fork, diamond)
- Fixed seeds → identical hashes (10/10 runs)
- Validates determinism guarantee

### Integration Tests (`tests/run.scm-lite.integration.test.ts`)
- End-to-end /v1/run with SCM-Lite enabled
- Determinism: 10/10 identical response_hash + bma_hash
- Contract: valid report.v1 with monotone quantiles
- 429 parity: rate-limit headers unchanged

### Performance Tests (`tests/scm-lite/kernel.perf.test.ts`)
- 12-node reference graph: p95 ≤ 600ms
- 4-node baseline: p95 < 50ms
- Warm-up runs to stabilize JIT

---

## References

### Structural Causal Models
- Pearl, J. (2009). *Causality: Models, Reasoning, and Inference*
- Peters, J., Janzing, D., & Schölkopf, B. (2017). *Elements of Causal Inference*

### Bayesian Model Averaging
- Hoeting, J. A., et al. (1999). "Bayesian Model Averaging: A Tutorial"
- Raftery, A. E., et al. (1997). "Bayesian Model Selection in Social Research"

### Deterministic RNG
- Marsaglia, G. (2003). "Xorshift RNGs"
- O'Neill, M. E. (2014). "PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number Generation"

---

## Changelog

### v1.0 (2025-01-14)
- Initial production release
- XorShift128+ deterministic RNG
- Edge masking with Bernoulli sampling
- p10/p50/p90 quantiles + BMA hash
- Confidence heuristic (diversity + stability + paths)
- Performance: p95=3.25ms for 12-node graphs
- Integration with /v1/run (flagged OFF)
