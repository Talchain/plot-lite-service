## [Unreleased] – Safety Nets v2, docs & tests
- Engine hardening: run-level cap (`--maxRunMs`) and attempt-level circuit breaker (`--consecFailLimit`).
- Report v1.3 candidate: `summary.stepCountByType`, `runTimeoutTriggered`, `circuitBreakerTriggered`.
- New steps: `calc`, `map` (+ Ajv schemas, docs, and tests).
- Docs: Usage section for Safety Nets v2; examples & fixture `docs/plot-lite-engine/fixtures/safety-caps-demo.json`.
- Tests: Deterministic breaker + timeout flags tests (seed=42).
- CI: smoke job ensures engine tests run and uploads `reports/tests.json`.
