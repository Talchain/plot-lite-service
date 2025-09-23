# Architecture (v1)
## Components
- **Engine Core:** Loads plot JSON, validates, executes with timeouts/retries.
- **Step Registry:** Built-ins (HTTP, transform, LLM), pluggable via interface.
- **Observability:** Metrics (success, latency, cost), structured logs, trace-id.
- **Config/Flags:** Env + localStorage gates for UX; kill switches.
- **Storage (MVP):** In-memory + JSON files; add Redis/Postgres later.

## Execution Model
1. Validate plot (schema).
2. Execute step-by-step with guardrails (timeouts, caps).
3. On fork: evaluate condition → branch.
4. Emit event stream for UI (SSE/websocket) [optional].
5. Write a compact execution record.

## Safety
- Per-step timeout + retry caps.
- Rate limiting on external calls.
- Input/output schema checks.
