# Examples
See fixtures under `fixtures/plots/`. Validate locally via:


node tools/plot-validate.cjs

The validation report is written to `reports/plot-validate.json`.

## Calc + Map pipeline (transform → calc → map → gate)

A minimal plot showing the new steps together. See also docs/plot-lite-engine/fixtures/calc-map.json.

{
  "id": "demo-calc-map", "version": "1",
  "steps": [
    { "id": "t1", "type": "transform", "inputs": { "assign": { "a": 2, "b": 3, "tier": "gold" } } },
    { "id": "c1", "type": "calc", "inputs": { "assignTo": "score.total", "expr": "(a+b)*2" } },
    { "id": "m1", "type": "map", "inputs": { "fromPath": "tier", "mapping": { "gold": "GOLD", "free": "FREE" }, "default": "UNK", "assignTo": "tierLabel" } },
    { "id": "g1", "type": "gate", "inputs": { "path": "score.total", "op": ">=", "value": 10, "onTrue": "__end" } }
  ]
}
## Safety Nets demo
Run with flags:
node tools/plot-run.cjs docs/plot-lite-engine/fixtures/safety-nets-demo.json --seed=42 --maxRunMs=200 --consecFailLimit=2

