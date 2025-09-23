# PLoT Lite Engine — Overview (v1)
**Goal:** A small, safe, observable engine that executes decision “plots” (scenarios) with clear inputs, repeatable steps, and auditable outputs.

## Scope
- Execute a defined flow (steps, guards, forks) deterministically.
- Emit metrics (latency, success, cost), logs, and a minimal trace.
- Provide a tiny registry for step types (HTTP call, transform, LLM call, gate).

## Constraints & Non-goals
- Keep minimal: no heavy orchestration, no external queue to start.
- Non-goal: enterprise scheduler, multi-tenant auth (later).
- First class safety: feature flags, rate limits, timeouts, retries with caps.

## Glossary
- **Plot:** A DAG-like scenario.
- **Step:** A node with type, inputs, and outputs.
- **Fork:** Conditional path split; may suggest “Split/Continue”.
