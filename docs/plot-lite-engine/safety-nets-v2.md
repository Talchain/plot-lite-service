# Safety Nets v2 — Circuit Breaker and Retry Backoff

## Circuit Breaker
- States: closed → open → half-open → closed
- Policy per step (example):
  - `breaker: { failThreshold: 2, cooldownMs: 50, halfOpenMax: 1 }`
- Behaviour:
  - After `failThreshold` consecutive failures, the breaker opens for `cooldownMs`.
  - During open, attempts are rejected (reason `breaker-open`).
  - After cooldown, transitions to half-open, allowing up to `halfOpenMax` probes.
  - Any success closes the breaker and resets counters.
  - Reasons `budget-exceeded` and `breaker-open` do not count toward failure tally.

## Retry Backoff
- Unified helper provides deterministic delays:
  - `backoffNext({ strategy: 'fixed'|'exponential', baseMs, maxMs, jitter: 'full'|false, attempt, seedParts })`
- Jitter uses a seeded pseudo-random fraction based on a stable seed (e.g., `{ traceId, step.id, attempt }`).
- Deterministic across runs for the same seed.

## Usage
- Configure per-step:
```json
{
  "id": "x",
  "type": "someStep",
  "retry": { "max": 3, "backoffMs": [ 20 ], "jitter": true },
  "breaker": { "failThreshold": 2, "cooldownMs": 50, "halfOpenMax": 1 }
}
```
