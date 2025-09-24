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
