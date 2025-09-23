# Usage (M0)

## Run tests (no external deps)

node tools/run-tests.cjs

Outputs: reports/tests.json with summary and per-case results.

## Run a plot

node tools/plot-run.cjs fixtures/plots/hello-world.json

Writes an execution record under reports/runs/<timestamp>-<plotId>.json with record, stats, and events.

## Micro-benchmark

node tools/bench-engine.cjs

Writes reports/bench-engine.json containing mean/median/p95 per-step durations across 3x1000-step runs.
