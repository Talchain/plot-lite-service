# B3 Auto-noise disclosure — replay fixtures

Captured via `tests/b3-auto-noise-disclosure.test.ts` to document the
public-response shape across the four `analysis_status` states.

| State | File | Purpose |
| --- | --- | --- |
| `computed`, `applied: true` | `state-applied.json` | Happy path — provenance present, all enums match v1. |
| `computed`/`partial`, `applied: false` | `state-not-applied.json` | ISL flag false; provenance still present with full formula metadata. |
| `computed`/`partial`, ISL omits flag | `state-isl-omitted.json` | Top-level `auto_noise_applied` is `null`; provenance still emitted with `applied: false` (conservative default). |
| `blocked` | `state-blocked.json` | Preflight rejection (HTTP 422). Both `auto_noise_applied` and `auto_noise_provenance` absent. |

These JSONs only show the auto-noise-relevant fields; the full payload
includes the standard V3 surface (option_comparison, factor_sensitivity,
robustness, etc.).
