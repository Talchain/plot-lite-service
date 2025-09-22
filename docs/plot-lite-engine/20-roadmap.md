# Roadmap
## M0 — Skeleton Running (1–2 days)
- Engine loads & runs a 3-step plot (transform, HTTP mock, gate).
- Minimal metrics/logs; JSON execution record.
- Acceptance: demo plot runs locally; `reports/tests.json` produced.

## M1 — Built-ins & Guardrails (3–5 days)
- Step types: HTTP, transform, LLM (flagged).
- Timeouts, retries, rate limit; basic fork.
- Acceptance: sample plots pass; guardrails observable.

## M2 — Observability & Dev UX (3–5 days)
- Structured logs, counters/histograms; trace-id propagation.
- Developer docs; quickstart; plan index.
- Acceptance: CLI or docs summary; artifacts present.

## M3 — Jobs/Gateway (optional)
- Background worker + tiny gateway.
- Acceptance: sandbox can trigger jobs; resiliency smoke tests.
