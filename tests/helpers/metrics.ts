/**
 * Test helper for polling and asserting Prometheus metrics
 * Handles async metric updates with configurable retry logic
 */

export interface WaitForMetricOptions {
  /** Base URL of the server (e.g., http://localhost:3000) */
  baseUrl: string;
  /** Metric query pattern to search for (regex or string) */
  query: string | RegExp;
  /** Minimum expected value (for counters/gauges) */
  min?: number;
  /** Maximum expected value (for counters/gauges) */
  max?: number;
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Poll interval in milliseconds (default: 200) */
  pollIntervalMs?: number;
}

export interface MetricValue {
  /** Full metric line from /metrics */
  line: string;
  /** Extracted numeric value (if parseable) */
  value: number | null;
  /** Metric labels as key-value pairs */
  labels: Record<string, string>;
}

/**
 * Wait for a metric to appear and optionally meet min/max criteria
 * 
 * @param options - Configuration for metric polling
 * @returns Metric value and line when found
 * @throws Error if timeout exceeded or criteria not met
 * 
 * @example
 * ```typescript
 * // Wait for validation counter to increment
 * const metric = await waitForMetric({
 *   baseUrl: 'http://localhost:3000',
 *   query: /plot_engine_validation_errors_total\{route="\/v1\/run"/,
 *   min: 1,
 *   timeoutMs: 5000
 * });
 * 
 * console.log(metric.value); // e.g., 3
 * ```
 */
export async function waitForMetric(options: WaitForMetricOptions): Promise<MetricValue> {
  const {
    baseUrl,
    query,
    min,
    max,
    timeoutMs = 5000,
    pollIntervalMs = 200
  } = options;

  const startTime = Date.now();
  const queryRegex = typeof query === 'string' ? new RegExp(query) : query;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Fetch metrics
      const response = await fetch(`${baseUrl}/metrics`);
      if (!response.ok) {
        throw new Error(`Metrics endpoint returned ${response.status}`);
      }

      const text = await response.text();
      const lines = text.split('\n');

      // Find matching metric line
      const matchingLine = lines.find(line => queryRegex.test(line));

      if (matchingLine) {
        const parsed = parseMetricLine(matchingLine);

        // Check min/max criteria
        if (min !== undefined && parsed.value !== null && parsed.value < min) {
          // Continue polling
          await sleep(pollIntervalMs);
          continue;
        }

        if (max !== undefined && parsed.value !== null && parsed.value > max) {
          throw new Error(
            `Metric value ${parsed.value} exceeds max ${max}: ${matchingLine}`
          );
        }

        // Success!
        return parsed;
      }
    } catch (error) {
      // Network errors - continue polling
      if (Date.now() - startTime >= timeoutMs) {
        throw error;
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for metric matching ${query} (${timeoutMs}ms)` +
    (min !== undefined ? ` with min=${min}` : '') +
    (max !== undefined ? ` with max=${max}` : '')
  );
}

/**
 * Parse a Prometheus metric line into structured data
 * 
 * @param line - Metric line from /metrics endpoint
 * @returns Parsed metric with value and labels
 * 
 * @example
 * ```typescript
 * const parsed = parseMetricLine(
 *   'plot_engine_validation_errors_total{route="/v1/run",phase="request"} 5'
 * );
 * // { line: '...', value: 5, labels: { route: '/v1/run', phase: 'request' } }
 * ```
 */
export function parseMetricLine(line: string): MetricValue {
  const labels: Record<string, string> = {};
  let value: number | null = null;

  // Extract labels (if present)
  const labelsMatch = line.match(/\{([^}]+)\}/);
  if (labelsMatch) {
    const labelPairs = labelsMatch[1].split(',');
    for (const pair of labelPairs) {
      const [key, val] = pair.split('=');
      if (key && val) {
        labels[key.trim()] = val.trim().replace(/^"|"$/g, '');
      }
    }
  }

  // Extract value (last number on the line)
  const valueMatch = line.match(/\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$/);
  if (valueMatch) {
    value = parseFloat(valueMatch[1]);
  }

  return { line, value, labels };
}

/**
 * Get current value of a metric (no polling)
 * 
 * @param baseUrl - Base URL of the server
 * @param query - Metric query pattern
 * @returns Metric value or null if not found
 * 
 * @example
 * ```typescript
 * const current = await getMetricValue(
 *   'http://localhost:3000',
 *   /plot_engine_validation_errors_total/
 * );
 * ```
 */
export async function getMetricValue(
  baseUrl: string,
  query: string | RegExp
): Promise<MetricValue | null> {
  const response = await fetch(`${baseUrl}/metrics`);
  if (!response.ok) {
    throw new Error(`Metrics endpoint returned ${response.status}`);
  }

  const text = await response.text();
  const queryRegex = typeof query === 'string' ? new RegExp(query) : query;
  const lines = text.split('\n');
  const matchingLine = lines.find(line => queryRegex.test(line));

  return matchingLine ? parseMetricLine(matchingLine) : null;
}

/**
 * Assert that a metric exists and optionally meets criteria
 * 
 * @param baseUrl - Base URL of the server
 * @param query - Metric query pattern
 * @param expected - Expected value or range
 * @throws Error if metric not found or doesn't match
 * 
 * @example
 * ```typescript
 * await assertMetric(
 *   'http://localhost:3000',
 *   /plot_engine_validation_errors_total/,
 *   { min: 1 }
 * );
 * ```
 */
export async function assertMetric(
  baseUrl: string,
  query: string | RegExp,
  expected?: { min?: number; max?: number; exact?: number }
): Promise<void> {
  const metric = await getMetricValue(baseUrl, query);

  if (!metric) {
    throw new Error(`Metric not found: ${query}`);
  }

  if (expected?.exact !== undefined && metric.value !== expected.exact) {
    throw new Error(
      `Metric value ${metric.value} does not equal expected ${expected.exact}`
    );
  }

  if (expected?.min !== undefined && metric.value !== null && metric.value < expected.min) {
    throw new Error(
      `Metric value ${metric.value} is less than min ${expected.min}`
    );
  }

  if (expected?.max !== undefined && metric.value !== null && metric.value > expected.max) {
    throw new Error(
      `Metric value ${metric.value} exceeds max ${expected.max}`
    );
  }
}

/**
 * Sleep helper for polling loops
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
