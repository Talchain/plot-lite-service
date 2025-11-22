# Error Taxonomy and Messages

Types:
- BAD_INPUT
- TIMEOUT
- BLOCKED_CONTENT
- RETRYABLE
- INTERNAL
- RATE_LIMIT
- BREAKER_OPEN

HTTP mapping (typical):
- BAD_INPUT → 400 (or 404 for specific cases e.g. INVALID_TEMPLATE/INVALID_SEED)
- TIMEOUT → 504
- RETRYABLE → 503
- INTERNAL → 500
- RATE_LIMIT → 429 (must include Retry-After)
- BREAKER_OPEN → 503

Catalogue phrases (British English):
- BAD_INPUT_SCHEMA → "Request validation failed"
- RATE_LIMIT_RPM → "Too many requests, please try again shortly"
- TIMEOUT_UPSTREAM → "The service took too long to respond"
- INTERNAL_UNEXPECTED → "Something went wrong"
- BREAKER_OPEN → "Service temporarily unavailable, please try again shortly"
- INVALID_TEMPLATE → "Unknown template name"
- INVALID_SEED → "Unknown seed for template"
- BAD_QUERY_PARAMS → "Invalid query parameters"

Rules:
- One human reason per response; no stack traces; consistent public shapes `{ error: { type, message, hint?, fields? } }`.
- Use the catalogue message for public payloads; never leak `devDetail`.
