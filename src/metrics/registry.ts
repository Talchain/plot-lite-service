/**
 * P1: Prometheus Histogram Registry
 * Production-safe metrics with bounded label cardinality
 * 
 * PR-1: Added Counter class for circuit breaker events (always-on)
 */

interface HistogramBucket {
  le: number;
  count: number;
}

interface Histogram {
  sum: number;
  count: number;
  buckets: Map<string, HistogramBucket[]>;
}

/**
 * Counter metric (PR-1)
 */
class CounterMetric {
  private name: string;
  private help: string;
  private labelNames: string[];
  private data: Map<string, number>;

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.data = new Map();
  }

  inc(labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.makeKey(labels);
    const current = this.data.get(key) || 0;
    this.data.set(key, current + value);
  }

  render(): string {
    const lines: string[] = [];
    
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);

    if (this.data.size === 0) {
      // Emit zero if no data
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, count] of this.data.entries()) {
        if (this.labelNames.length > 0) {
          const labels = this.parseKey(key);
          const labelStr = this.formatLabels(labels);
          lines.push(`${this.name}{${labelStr}} ${count}`);
        } else {
          lines.push(`${this.name} ${count}`);
        }
      }
    }

    return lines.join('\n');
  }

  private makeKey(labels: Record<string, string>): string {
    if (this.labelNames.length === 0) return '';
    const parts: string[] = [];
    for (const name of this.labelNames) {
      parts.push(`${name}=${labels[name] || 'unknown'}`);
    }
    return parts.join(',');
  }

  private parseKey(key: string): Record<string, string> {
    const labels: Record<string, string> = {};
    if (!key) return labels;
    for (const part of key.split(',')) {
      const [name, value] = part.split('=');
      labels[name] = value;
    }
    return labels;
  }

  private formatLabels(labels: Record<string, string>): string {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(labels)) {
      parts.push(`${name}="${value}"`);
    }
    return parts.join(',');
  }

  reset(): void {
    this.data.clear();
  }
}

// Bucket boundaries in seconds (sane defaults for API latency)
const BUCKETS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

class HistogramMetric {
  private name: string;
  private help: string;
  private labelNames: string[];
  private data: Map<string, Histogram>;

  constructor(name: string, help: string, labelNames: string[]) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.data = new Map();
  }

  observe(labels: Record<string, string>, value: number): void {
    const key = this.makeKey(labels);
    let hist = this.data.get(key);
    
    if (!hist) {
      hist = {
        sum: 0,
        count: 0,
        buckets: new Map(),
      };
      this.data.set(key, hist);
    }

    hist.sum += value;
    hist.count += 1;

    // Update buckets
    let buckets = hist.buckets.get(key);
    if (!buckets) {
      buckets = BUCKETS.map(le => ({ le, count: 0 }));
      hist.buckets.set(key, buckets);
    }

    // Increment all buckets >= value
    for (const bucket of buckets) {
      if (value <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  render(): string {
    const lines: string[] = [];
    
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    for (const [key, hist] of this.data.entries()) {
      const labels = this.parseKey(key);
      const labelStr = this.formatLabels(labels);

      const buckets = hist.buckets.get(key) || [];
      for (const bucket of buckets) {
        lines.push(`${this.name}_bucket{${labelStr},le="${bucket.le}"} ${bucket.count}`);
      }
      lines.push(`${this.name}_bucket{${labelStr},le="+Inf"} ${hist.count}`);
      lines.push(`${this.name}_sum{${labelStr}} ${hist.sum}`);
      lines.push(`${this.name}_count{${labelStr}} ${hist.count}`);
    }

    return lines.join('\n');
  }

  private makeKey(labels: Record<string, string>): string {
    const parts: string[] = [];
    for (const name of this.labelNames) {
      parts.push(`${name}=${labels[name] || 'unknown'}`);
    }
    return parts.join(',');
  }

  private parseKey(key: string): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const part of key.split(',')) {
      const [name, value] = part.split('=');
      labels[name] = value;
    }
    return labels;
  }

  private formatLabels(labels: Record<string, string>): string {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(labels)) {
      parts.push(`${name}="${value}"`);
    }
    return parts.join(',');
  }

  reset(): void {
    this.data.clear();
  }
}

// Singleton registry
let requestDurationHistogram: HistogramMetric | null = null;
let engineLatencyHistogram: HistogramMetric | null = null;

// PR-1: Circuit breaker counters (always-on collection)
let rateLimitCounter: CounterMetric | null = null;
let circuitOpenCounter: CounterMetric | null = null;
let circuitProbesCounter: CounterMetric | null = null;
let ceeAttemptedCounter: CounterMetric | null = null;
let ceeOkCounter: CounterMetric | null = null;
let ceeSkippedCounter: CounterMetric | null = null;
let ceeDegradedCounter: CounterMetric | null = null;

export function initializeHistograms(): void {
  if (process.env.PROMETHEUS_ENABLE !== '1') {
    return;
  }

  requestDurationHistogram = new HistogramMetric(
    'plot_engine_request_duration_seconds',
    'HTTP request duration in seconds',
    ['route', 'method', 'status_class']
  );

  engineLatencyHistogram = new HistogramMetric(
    'plot_engine_engine_latency_seconds',
    'Core engine compute latency in seconds',
    ['phase', 'status_class']
  );

  // PR-1: Circuit breaker counters (always-on, regardless of RL_CB_ENABLE)
  rateLimitCounter = new CounterMetric(
    'plot_engine_rate_limit_429_total',
    'Total number of 429 rate limit responses',
    ['route']
  );

  circuitOpenCounter = new CounterMetric(
    'plot_engine_circuit_open_total',
    'Total number of circuit breaker opens',
    ['scope', 'reason'] // PR-2C: Add reason label (e.g., half_open_timeout)
  );

  circuitProbesCounter = new CounterMetric(
    'plot_engine_circuit_probes_total',
    'Total number of circuit breaker half-open probes',
    ['scope', 'result']
  );

  ceeAttemptedCounter = new CounterMetric(
    'plot_engine_cee_attempted_total',
    'Total number of CEE decision review attempts',
    ['route']
  );

  ceeOkCounter = new CounterMetric(
    'plot_engine_cee_ok_total',
    'Total number of successful CEE decision reviews',
    ['route']
  );

  ceeSkippedCounter = new CounterMetric(
    'plot_engine_cee_skipped_total',
    'Total number of skipped CEE decision reviews',
    ['route', 'reason']
  );

  ceeDegradedCounter = new CounterMetric(
    'plot_engine_cee_degraded_total',
    'Total number of degraded CEE decision reviews',
    ['route', 'code']
  );
}

export function observeRequestDuration(
  route: string,
  method: string,
  statusCode: number,
  durationMs: number
): void {
  if (!requestDurationHistogram) return;

  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  requestDurationHistogram.observe(
    { route, method, status_class: statusClass },
    durationMs / 1000 // Convert to seconds
  );
}

export function observeEngineLatency(
  phase: string,
  statusCode: number,
  durationMs: number
): void {
  if (!engineLatencyHistogram) return;

  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  engineLatencyHistogram.observe(
    { phase, status_class: statusClass },
    durationMs / 1000 // Convert to seconds
  );
}

// PR-1: Record circuit breaker events (always-on)
export function recordRateLimit429(route: string): void {
  rateLimitCounter?.inc({ route });
}

export function recordCircuitOpen(scope: 'global' | 'principal', reason?: string): void {
  circuitOpenCounter?.inc({ scope, reason: reason || 'threshold' });
}

export function recordCircuitProbe(scope: 'global' | 'principal', result: 'success' | 'failure'): void {
  circuitProbesCounter?.inc({ scope, result });
}

export function recordCeeAttempted(route: string): void {
  ceeAttemptedCounter?.inc({ route });
}

export function recordCeeOk(route: string): void {
  ceeOkCounter?.inc({ route });
}

export function recordCeeSkipped(route: string, reason: string): void {
  ceeSkippedCounter?.inc({ route, reason });
}

export function recordCeeDegraded(route: string, code: string): void {
  ceeDegradedCounter?.inc({ route, code });
}

export function renderHistograms(): string {
  const lines: string[] = [];

  if (requestDurationHistogram) {
    lines.push(requestDurationHistogram.render());
  }

  if (engineLatencyHistogram) {
    lines.push(engineLatencyHistogram.render());
  }

  // PR-1: Render circuit breaker counters
  if (rateLimitCounter) {
    lines.push(rateLimitCounter.render());
  }

  if (circuitOpenCounter) {
    lines.push(circuitOpenCounter.render());
  }

  if (circuitProbesCounter) {
    lines.push(circuitProbesCounter.render());
  }

  if (ceeAttemptedCounter) {
    lines.push(ceeAttemptedCounter.render());
  }

  if (ceeOkCounter) {
    lines.push(ceeOkCounter.render());
  }

  if (ceeSkippedCounter) {
    lines.push(ceeSkippedCounter.render());
  }

  if (ceeDegradedCounter) {
    lines.push(ceeDegradedCounter.render());
  }

  return lines.join('\n');
}

export function resetHistograms(): void {
  requestDurationHistogram?.reset();
  engineLatencyHistogram?.reset();
  rateLimitCounter?.reset();
  circuitOpenCounter?.reset();
  circuitProbesCounter?.reset();
  ceeAttemptedCounter?.reset();
  ceeOkCounter?.reset();
  ceeSkippedCounter?.reset();
  ceeDegradedCounter?.reset();
}
