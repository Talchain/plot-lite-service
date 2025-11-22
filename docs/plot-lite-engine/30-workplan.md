# Work Plan (Epics → Tasks)
## E1 Engine Core
- Parse & validate plot schema
- Executor with timeout/retry
- Execution record JSON

## E2 Step Registry
- Transform step
- HTTP step (mock first)
- LLM step (flagged)

## E3 Guardrails
- Rate limit per step type
- Retry/backoff with caps
- Fork evaluator + tests

## E4 Observability
- Metrics (success, latency, cost)
- Logs (structured)
- Minimal trace correlation

## E5 Dev Experience
- Quickstart docs
- Plan index generator
- Example plots + fixtures

**Definition of Done:** tests for each step; reports/tests.json present; docs updated.
