# Baseline Measurement Protocol

## Purpose
Measure test suite stability with rigorous, steady-state 10× runs to establish non-regression baselines.

## Protocol

### 1. Warm-up (Not Counted)
```bash
# Build to precompile TypeScript
npx tsc -p tsconfig.json

# Smoke test to warm caches (not counted in 10×)
npx vitest run --reporter=dot || true
```

**Why**: Eliminates cold-start spikes from JIT compilation and test discovery.

### 2. True 10× Measurement
```bash
# Run 10 iterations, all counted
./tools/baseline/run_n.sh 10

# Analyze results
node tools/baseline/analyze.mjs
```

**Output**: `.baseline-summary.json` with:
- `failures`: Array of failure counts per run
- `best`, `worst`, `mean`, `std`
- `baseline`: `max(worst, ceil(mean + 2σ))`

### 3. Non-Regression Check
```
delta = branch_worst - main_baseline
✅ Pass: delta ≤ 0
❌ Fail: delta > 0 (regression)
```

## Rules

1. **No cherry-picking**: Count all 10 runs after warm-up
2. **Steady-state**: Always warm-up before measurement
3. **Serial execution**: One run at a time to avoid port conflicts
4. **Continue on failure**: Script uses `|| true` to collect full series

## Example

```bash
# Main baseline
main baseline (10×):    baseline = 9

# Branch measurement
this branch (10×):      worst = 7, baseline = 8
delta:                  -2  ✅
```

## Artifacts

- `.ci-run{1..10}.txt`: Individual run outputs
- `.baseline-summary.json`: Analyzer output (commit this)

## Gitignore Recommendation

```gitignore
# Baseline artifacts (optional: keep or ignore)
.ci-run*.txt
.baseline-summary*.json
```
