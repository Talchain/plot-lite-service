# Usage (M0)

## Run tests (no external deps)

node tools/run-tests.cjs

Outputs: reports/tests.json with summary and per-case results.

## Run a plot

node tools/plot-run.cjs fixtures/plots/hello-world.json

Writes an execution record under reports/runs/<timestamp>-<plotId>.json with record, stats, and events.

## Calc step (deterministic arithmetic)

Use calc to compute numeric expressions from context and optional vars.
Example:

{
  "id": "c1", "type": "calc",
  "inputs": { "assignTo": "score.total", "expr": "(a+b)*2" }
}

## Map step (value mapping)

Map a context value via a lookup, optionally writing to a new path.
Example:

{
  "id": "m1", "type": "map",
  "inputs": { "fromPath": "tier", "mapping": { "gold": "GOLD" }, "default": "UNK", "assignTo": "tierLabel" }
}

## Micro-benchmark

node tools/bench-engine.cjs

Writes reports/bench-engine.json containing mean/median/p95 per-step durations across 3x1000-step runs.
## Safety Nets v2 (run cap + circuit breaker)

The engine now has two built-in “brakes” to keep runs safe, fast, and predictable:

- **Run cap**: a hard wall-clock limit for the entire run. If exceeded, the engine appends a system step `__run` with `errorCode: RUN_TIMEOUT` and sets the top-level flag `runTimeoutTriggered: true`.
- **Consecutive-failure circuit breaker**: if a streak of step attempts fail with no success in between, the engine stops early, adds `__run` with `errorCode: CIRCUIT_BREAKER`, and sets `circuitBreakerTriggered: true`.

### How to use

**CLI flags (override everything):**
```bash
node tools/plot-run.cjs <plot.json> --seed=42 --maxRunMs=200 --consecFailLimit=2
```
