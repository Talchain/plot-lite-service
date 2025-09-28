// src/lib/error-messages.ts
export const ERR_MSG = {
  REQUEST_ITEMS_REQUIRED: "Request must include items array",
  BAD_INPUT_SCHEMA: "Request validation failed",
  NODE_CAP_EXCEEDED: "Scenario too large for pilot (12-node cap)",
  URL_TOO_LARGE: "Share link too large (8 KB maximum)",
  RATE_LIMIT_RPM: "Too many requests, please try again shortly",
  TIMEOUT_UPSTREAM: "The service took too long to respond",
  RETRYABLE_UPSTREAM: "Temporary problem, please try again shortly",
  INTERNAL_UNEXPECTED: "Something went wrong",
  BREAKER_OPEN: "Service temporarily unavailable, please try again shortly",
  // add any other phrases our tests/docs expect:
  INVALID_TEMPLATE: "Unknown template name",
  INVALID_SEED: "Unknown seed for template",
  BAD_QUERY_PARAMS: "Invalid query parameters",
} as const;

export type ErrKey = keyof typeof ERR_MSG;

export function msg(key: ErrKey): string {
  return ERR_MSG[key];
}

// Optional tiny templating for limits/caps
export function fmt(key: ErrKey, vars: Record<string, string | number> = {}): string {
  let s: string = ERR_MSG[key];
  for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`{${k}}` , "g"), String(v));
  return s;
}
