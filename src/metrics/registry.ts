/**
 * P1: Prometheus Histogram Registry
 * Production-safe metrics with bounded label cardinality
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

export function renderHistograms(): string {
  const lines: string[] = [];

  if (requestDurationHistogram) {
    lines.push(requestDurationHistogram.render());
  }

  if (engineLatencyHistogram) {
    lines.push(engineLatencyHistogram.render());
  }

  return lines.join('\n');
}

export function resetHistograms(): void {
  requestDurationHistogram?.reset();
  engineLatencyHistogram?.reset();
}
