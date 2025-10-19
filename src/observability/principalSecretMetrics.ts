/**
 * P0-2: Principal Secret Rotation Metrics
 * Tracks which secret (active vs staged) was used for verification
 */

const counts = { active: 0, staged: 0 };

export function incPrincipalSecretFallback(kind: 'active' | 'staged'): void {
  counts[kind]++;
}

export function renderPrincipalSecretFallback(): string {
  const total = counts.active + counts.staged;
  if (total === 0) return '';
  return [
    '# HELP plot_engine_principal_secret_fallback_total Principal secret verification source',
    '# TYPE plot_engine_principal_secret_fallback_total counter',
    `plot_engine_principal_secret_fallback_total{used="active"} ${counts.active}`,
    `plot_engine_principal_secret_fallback_total{used="staged"} ${counts.staged}`,
  ].join('\n');
}

// Test helper
export function __resetPrincipalSecretMetricsForTest(): void {
  counts.active = 0;
  counts.staged = 0;
}
