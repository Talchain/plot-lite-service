/**
 * Single source of truth for the server-side Bearer auth secret.
 *
 * Every live caller (CEE PLoTClient, the staging smoke + load-probe workflows)
 * already sends the value provisioned as PLOT_AUTH_TOKEN — that is the
 * caller-facing name, and on staging it is the ONLY auth var actually set
 * (AUTH_TOKEN is unset there). The historical/documented server-side name is
 * AUTH_TOKEN (env.example, render.yaml, docs/RENDER_SETUP.md, config-validator).
 *
 * We resolve PLOT_AUTH_TOKEN first, then fall back to AUTH_TOKEN, so a single
 * reader satisfies BOTH the deployed staging reality AND any env
 * (production / local dev / CI) that still provisions the historical name.
 * One resolver, no hand-maintained two-var mirror: rotating the deployed
 * secret can never silently strand the guard on an empty expected token
 * (the silent-breakage-on-rotation class).
 *
 * `||` (not `??`) so an empty-string PLOT_AUTH_TOKEN also falls through to
 * AUTH_TOKEN — matching the original guard's `AUTH_TOKEN || ''` idiom.
 *
 * Read fresh on every call (env may change between tests / at runtime); never
 * cache. This function performs NO auth decision — callers gate it behind
 * AUTH_ENABLED so it is inert while auth is off.
 */
export function getExpectedAuthToken(): string {
  return String(process.env.PLOT_AUTH_TOKEN || process.env.AUTH_TOKEN || '').trim();
}
