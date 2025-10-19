/**
 * P0-1: Validation Error Metrics
 * Tracks request and response validation failures
 */

// In-memory counters for validation errors
const validationErrors = new Map<string, number>();

export function incValidationError(route: string, phase: 'request' | 'response', errorType: string): void {
  const key = `${route}|${phase}|${errorType}`;
  validationErrors.set(key, (validationErrors.get(key) || 0) + 1);
}

export function getValidationErrors(): Map<string, number> {
  return new Map(validationErrors);
}

export function renderValidationMetrics(): string {
  const lines: string[] = [];
  lines.push('# HELP plot_engine_validation_errors_total API validation failures');
  lines.push('# TYPE plot_engine_validation_errors_total counter');
  
  for (const [key, count] of validationErrors.entries()) {
    const [route, phase, errorType] = key.split('|');
    lines.push(`plot_engine_validation_errors_total{route="${route}",phase="${phase}",error_type="${errorType}"} ${count}`);
  }
  
  return lines.join('\n');
}

// Test helper
export function __resetValidationMetricsForTest(): void {
  validationErrors.clear();
}
