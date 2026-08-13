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
  return String(
    process.env.PLOT_AUTH_TOKEN_ACTIVE || process.env.PLOT_AUTH_TOKEN || process.env.AUTH_TOKEN || '',
  ).trim();
}

/**
 * The OPTIONAL second accepted secret, for zero-downtime rotation.
 *
 * ── WHY A SECOND ACCEPTED VALUE ────────────────────────────────────────────
 * `getExpectedAuthToken` resolves ONE value, and `authGuard` accepts only that,
 * so every caller has to change in the same instant the server's value changes:
 * CEE's Render env, the UI's Netlify env, and the `PLOT_AUTH_TOKEN` GitHub Actions
 * secret used by `staging-smoke.yml` (which runs on every push to staging) and
 * `load-probe-nightly.yml`. No ordering of those edits avoids a window in which
 * something is sending a value the server no longer accepts — and because the
 * smoke workflow is one of those callers, a blind cutover disables the check that
 * would report the breakage it caused.
 *
 * With STAGED set, rotation becomes: set STAGED to the new value → update every
 * caller → watch `plot_engine_auth_token_match_total{used="active"}` stop climbing
 * → promote STAGED into the active name and clear STAGED. Nothing is ever sending
 * a value the server will not accept.
 *
 * The counter is what makes the final step safe: without evidence that nothing
 * matches ACTIVE any more, deleting it is a guess.
 *
 * Same shape as `PRINCIPAL_HMAC_SECRET_STAGED` (P0-2, `verifyPrincipalSignature`),
 * deliberately — one rotation idiom in this service, not two under different names.
 *
 * Empty/unset is the normal state and means "no rotation in progress": the guard
 * then behaves exactly as before.
 */
export function getStagedAuthToken(): string {
  return String(process.env.PLOT_AUTH_TOKEN_STAGED || process.env.AUTH_TOKEN_STAGED || '').trim();
}
