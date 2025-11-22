# Guardrails (M1)

This engine includes lightweight guardrails per step: timeout, retry, rateLimit, and budget. All are deterministic and dependency-free.

Options

- timeoutMs: number
  - Caps the maximum run time of a step. The effective timeout is min(step.timeoutMs, maxDurationMs) provided to runPlot.
  - Failure on timeout is retryable if retry policy allows. Final failure reason: "timeout".

- retry?: { max: number, backoffMs?: number[], jitter?: boolean }
  - Attempts: up to retry.max times. If max is 0, no retries (1 attempt total).
  - Backoff schedule: backoffMs[i] used for attempt i+1 (exhausted schedule uses the last value). 0 means no wait.
  - Jitter: if true, apply ±10% deterministic jitter to the chosen backoff (see Deterministic jitter).
  - Emits event {type:'retry', id, attempt, error} on each retry.
  - Final failure reason (when not timeout/rate-limit): "retry-exhausted".

- rateLimit?: { key: string, limit: number, intervalMs: number }
  - Simple in-process fixed-window limiter per key.
  - Each acquire is evaluated before invoking the handler of each attempt.
  - Denied acquisitions are treated as retryable. Final failure reason: "rate-limit" when attempts are exhausted.

- cost?: { estimate?: number }
  - On successful step completion, stats.cost += estimate.

Budget (runPlot option)

- runPlot(plot, { budget?: { maxCost?: number } })
- Before executing a step, if maxCost is set and (stats.cost + step.cost.estimate) would exceed it, the step is recorded as failure with reason "budget-exceeded" and attempts=0. Execution stops.

Recording and stats

- record.steps[]: { id, type, status: 'ok'|'fail', durationMs, attempts, reason? }
  - reason appears only on failure and is one of: "timeout", "rate-limit", "budget-exceeded", "retry-exhausted".
- stats: { totalMs, steps, ok, failed, retries, cost }
  - retries counts total retry attempts across steps.

Deterministic jitter

- Jitter factor is derived from a 32-bit hash of `${traceId}|${step.id}|${attempt}` mapped to ±10%.
- This ensures reproducible backoff schedules for a given trace.

Events

- Emitted events: step-start, step-ok, step-fail, retry, fork, done.

Examples

- Timeout with retry

```json path=null start=null
{
  "id": "t1",
  "type": "http",
  "timeoutMs": 200,
  "retry": { "max": 3, "backoffMs": [50, 100], "jitter": true }
}
```

- Rate limit per key

```json path=null start=null
{ "id": "s1", "type": "transform", "rateLimit": { "key": "k1", "limit": 1, "intervalMs": 1000 } }
{ "id": "s2", "type": "transform", "rateLimit": { "key": "k1", "limit": 1, "intervalMs": 1000 }, "retry": { "max": 0 } }
```

- Budget stop

```json path=null start=null
{
  "steps": [
    { "id": "a", "type": "transform", "cost": { "estimate": 0.6 }, "next": "b" },
    { "id": "b", "type": "transform", "cost": { "estimate": 0.6 } }
  ]
}
```

Failure reasons

- "timeout"
- "rate-limit"
- "budget-exceeded"
- "retry-exhausted"
