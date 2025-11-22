# Engine Error Codes

Tiny, stable taxonomy for PLoT‑lite engine adapter. Clients should treat these as fixed and map to user messages.

Types and HTTP status codes:

- BAD_INPUT → 400
  - Client sent invalid input. Fix the request and retry.
- TIMEOUT → 504
  - Timed out. The service exceeded its time budget.
- RETRYABLE → 503
  - Please try again. Temporary server-side condition; retry with backoff.
- INTERNAL → 500
  - Unexpected server error. Please try again later.
- RATE_LIMIT → 429
  - Too many requests. Respect Retry-After / X-RateLimit-Reset and reduce rate.
- BREAKER_OPEN → 503
  - Temporarily unavailable. Circuit breaker is open; retry later.

Response shape

- Error responses use:
  { "error": { "type": "…", "message": "…", "hint": "…", "fields": {…} } }
Notes

- Rate limiting replies include Retry-After (seconds) and X-RateLimit-Reset (epoch seconds).
- Deterministic endpoints never include request payloads in logs. Sensitive fields are redacted.
- Deterministic GET /draft-flows uses strong ETag over raw bytes to enable 304 Not Modified.

## Public error phrases (stable for PoC)

| Taxonomy (type) | HTTP | Public phrase                                             |
|-----------------|------|-----------------------------------------------------------|
| BAD_INPUT       | 400  | Request validation failed                                 |
| BAD_INPUT       | 400  | Invalid query parameters                                  |
| BAD_INPUT       | 404  | Unknown template name                                     |
| BAD_INPUT       | 404  | Unknown seed for template                                 |
| RATE_LIMIT      | 429  | Too many requests, please try again shortly               |
| TIMEOUT         | 504  | The service took too long to respond                      |
| INTERNAL        | 500  | Something went wrong                                      |
| BREAKER_OPEN    | 503  | Service temporarily unavailable, please try again shortly |
| BAD_INPUT       | 400  | Request must include items array                          |
| BAD_INPUT       | 400  | Scenario too large for pilot (12-node cap)                |
| BAD_INPUT       | 414  | Share link too large (8 KB maximum)                       |

Detailed schema paths are internal and may vary; public phrases remain stable.
