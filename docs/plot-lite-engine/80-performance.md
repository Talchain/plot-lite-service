# Performance & Benchmarks (M2)

How to run benches

- Engine micro-benchmark:

```
node tools/bench-engine.cjs
```

- Predicate-heavy benchmark:

```
node tools/bench-predicate.cjs
```

- Retry benchmark (optional engine-native retry):

```
node tools/bench-retry.cjs
```

Each writes a JSON report under reports/ with mean/median/p95 summaries.

Interpreting statistics

- mean: average time per step/attempt; sensitive to outliers
- median: 50th percentile; robust to outliers
- p95: 95th percentile; shows tail behavior

Tips for performance

- Predicate compiler and cache
  - Avoid parsing string conditions repeatedly; use compiled predicate functions with a small cache.
- Shallow ctx operations
  - Keep per-step work minimal; avoid deep clones; mutate ctx shallowly when safe.
- Minimal allocations
  - Reuse small arrays/objects where possible; avoid creating throwaway closures in hot paths.
- Deterministic jitter
  - Jitter is deterministic and cheap; no RNG state.
