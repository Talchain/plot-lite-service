/**
 * Bearer auth token rotation metrics.
 *
 * Tracks WHICH configured token a successful request matched — ACTIVE or STAGED —
 * so a rotation can be completed on evidence rather than on hope.
 *
 * THIS COUNTER IS THE POINT OF THE DUAL-ACCEPTANCE CHANGE, not a by-product of it.
 * Accepting two tokens is what makes a rotation possible; knowing that nothing has
 * matched ACTIVE for a while is what makes DELETING the old one safe. Without it,
 * removal is a guess — the same failure mode as invalidating a live credential
 * blind, only deferred to the end of the rollout.
 *
 * Operationally: set STAGED to the new value, update every caller (CEE's Render
 * env, the UI's Netlify env, the `PLOT_AUTH_TOKEN` GitHub Actions secret), watch
 * `used="active"` stop climbing, then promote STAGED and clear it. The counter is
 * what tells you when that last step is safe.
 *
 * ⚠ NEVER records or exposes a token VALUE — only which candidate matched. A
 * rotation aid that leaked either secret would be worse than the manual cutover it
 * replaces.
 *
 * Mirrors `principalSecretMetrics.ts` (P0-2) deliberately: same shape, same label
 * name, same reset-for-test helper, so there is one rotation idiom in this service
 * rather than two under different names.
 */

const counts = { active: 0, staged: 0 };

export function incAuthTokenMatch(kind: 'active' | 'staged'): void {
  counts[kind]++;
}

/**
 * Prometheus exposition, or '' when nothing has matched yet.
 *
 * BOTH labels are always emitted once anything has matched — including a zero.
 * That is deliberate: `used="active"} 0` is the signal an operator is waiting for,
 * and a series that vanished when it hit zero would be indistinguishable from a
 * series that was never scraped.
 */
export function renderAuthTokenMatch(): string {
  const total = counts.active + counts.staged;
  if (total === 0) return '';
  return [
    '# HELP plot_engine_auth_token_match_total Which configured bearer token a successful request matched',
    '# TYPE plot_engine_auth_token_match_total counter',
    `plot_engine_auth_token_match_total{used="active"} ${counts.active}`,
    `plot_engine_auth_token_match_total{used="staged"} ${counts.staged}`,
  ].join('\n');
}

// Test helper
export function __resetAuthTokenMetricsForTest(): void {
  counts.active = 0;
  counts.staged = 0;
}
