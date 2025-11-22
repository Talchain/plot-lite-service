# Budget and Timeouts

This engine enforces per-step timeouts and a run-level deadline to ensure bounded execution.

- Run-level deadline: when `maxDurationMs` is provided to `runPlot`, a `deadlineAt` is computed (`start + maxDurationMs`). Each step checks remaining time; if exhausted, the step short-circuits with reason `timeout`.
- Step timeout: individual steps can specify `timeoutMs`. The effective timeout for a step is the minimum of the remaining run time and the step’s own `timeoutMs` (if set).
- Budget pre-check: if a step declares `cost.estimate` and the remaining budget cannot cover it, the step short-circuits with reason `budget-exceeded`.

Notes
- Failure reasons are stable strings used by tests and reports.
- Deadlines are deterministic based on a captured start time.
