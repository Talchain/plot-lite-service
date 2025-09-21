
# PLoT-lite v1 Contract

_Last updated: 2025-09-20 22:08 BST_

## Scope

Deterministic draft flow generation and critique for the Scenario Sandbox PoC.

- Endpoints: `/draft-flows`, `/critique`, optional `/improve`, plus `/health` and `/version`.
- Determinism: Same `parse_text` + `context` + `seed` => byte-identical `parse_json_hash` and list ordering.
- Privacy: Service must not log `parse_text`. Callers should redact or hash on their side; provenance storage is org‑configurable.

## Data Contracts

- **OpenAPI**: `openapi-plot-lite-v1.yaml` in this folder.
- **JSON Schemas**: `schemas/flow.schema.json` (and in OpenAPI components).

### Typed Errors

- `BAD_INPUT` — e.g., missing baseline. Includes a human `hint` and optional `details`.
- `TIMEOUT` — service exceeded time budget; caller may downgrade quality or retry.
- `BLOCKED_CONTENT` — sensitive content or policy violation.
- `RETRYABLE` — transient issue. Clients must retry with the **same seed**.

### Hashing & Reproducibility

- `parse_json_hash` = `sha256(canonical_json(parse_json))` with:
  - UTF‑8, sorted keys, no whitespace differences.
  - Exclude ephemeral fields (`id` fields may remain if stable; client may supply UUIDv7 for nodes/edges).
- Model Cards must include: `{ seed, K, quality, snapshot_hash }`.

### Determinism Tests

Nightly job replays fixtures in `fixtures/` and asserts identical byte outputs and hashes.

### Threshold Catalogue

- Default for `en-GB`: `["£x9","£x99","£99","£199"]`.
- Clients may pass locale‑specific catalogues; Warp must treat them as hard rules for detection.

### Performance SLOs

- `/draft-flows` p95 service time ≤ 600 ms for ≤12 nodes drafts.
- `/critique` p95 ≤ 400 ms.

### Redaction Rules (Caller Guidance)

- `parse_text` stored in provenance only if org setting is ON.
- Exports redact `parse_text` by default; hashes preserve reproducibility.

## Change Control

- Any breaking change requires a new minor version and ADR.
- Contract tests in Windsurf consume fixtures and generated TS client; CI must pass before merging.

--
This document is the authoritative API contract for PLoT-lite v1.
