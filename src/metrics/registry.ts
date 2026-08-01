/**
 * P1: Prometheus Histogram Registry
 * Production-safe metrics with bounded label cardinality
 *
 * PR-1: Added Counter class for circuit breaker events (always-on)
 */

import type { AdmissionSkewReason } from '../integrations/isl/compute-admission.js';

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
// P1.3: SLO metrics by detail_level
let sloLatencyHistogram: HistogramMetric | null = null;

// PR-1: Circuit breaker counters (always-on collection)
let rateLimitCounter: CounterMetric | null = null;
let circuitOpenCounter: CounterMetric | null = null;
let circuitProbesCounter: CounterMetric | null = null;
let ceeAttemptedCounter: CounterMetric | null = null;
let ceeOkCounter: CounterMetric | null = null;
let ceeSkippedCounter: CounterMetric | null = null;
let ceeDegradedCounter: CounterMetric | null = null;

// P1.1: ISL integration metrics
let islValidationCounter: CounterMetric | null = null;
let islSensitivityCounter: CounterMetric | null = null;
let islFactorSensitivityCounter: CounterMetric | null = null;
let islRobustnessAnalysisCounter: CounterMetric | null = null;
let islLatencyHistogram: HistogramMetric | null = null;
// Codex F8 handshake — ISL /health compute-admission version-skew signal
let islAdmissionVersionSkewCounter: CounterMetric | null = null;

// Meta-reasoning quality metrics
let metaQualityHistogram: HistogramMetric | null = null;
let metaConfidenceCounter: CounterMetric | null = null;
let metaStabilityCounter: CounterMetric | null = null;
let metaConvergenceCounter: CounterMetric | null = null;

// P1: Observability header validation metrics
let payloadHashInvalidCounter: CounterMetric | null = null;

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

  // P1.3: SLO metrics by detail_level
  sloLatencyHistogram = new HistogramMetric(
    'plot_engine_slo_latency_seconds',
    'Request latency by detail_level for SLO tracking',
    ['detail_level', 'status_class']
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

  // P1.1: ISL integration metrics
  islValidationCounter = new CounterMetric(
    'plot_engine_isl_validation_total',
    'Total number of ISL validation calls',
    ['backend', 'result'] // backend: isl|fallback, result: ok|error|timeout
  );

  islSensitivityCounter = new CounterMetric(
    'plot_engine_isl_sensitivity_total',
    'Total number of ISL sensitivity calls',
    ['backend', 'result'] // backend: isl|fallback, result: ok|error|timeout
  );

  islFactorSensitivityCounter = new CounterMetric(
    'plot_engine_isl_factor_sensitivity_total',
    'Total number of ISL factor sensitivity calls',
    ['backend', 'result'] // backend: isl|fallback, result: ok|error|timeout
  );

  islRobustnessAnalysisCounter = new CounterMetric(
    'plot_engine_isl_robustness_analysis_total',
    'Total number of ISL robustness analysis calls (edge + factor sensitivity)',
    ['backend', 'result', 'edge_status', 'factor_status']
  );

  islLatencyHistogram = new HistogramMetric(
    'plot_engine_isl_latency_seconds',
    'ISL request latency in seconds',
    ['operation', 'result'] // operation: validation|sensitivity, result: ok|error
  );

  // Codex F8 handshake: fires when PLoT cannot plan against ISL's advertised
  // compute-admission model (unreachable /health, missing compute_admission
  // block, an unknown complexity_formula_version, or advertised weight keys the
  // known version's estimator does not price) and falls back to the
  // conservative legacy scalar bound. A sustained non-zero rate = drift, and
  // while it persists EVERY defaulted analysis runs at the reduced fallback
  // depth (ROADMAP 2.260 — now disclosed in the response, not just here).
  islAdmissionVersionSkewCounter = new CounterMetric(
    'plot_engine_isl_admission_version_skew_total',
    'Total detections of ISL compute-admission handshake skew (fail-loud fallback engaged)',
    // Label values are the AdmissionSkewReason union — see recordIslAdmissionVersionSkew below.
    ['reason']
  );

  // Meta-reasoning quality metrics
  metaQualityHistogram = new HistogramMetric(
    'plot_engine_meta_quality_score',
    'Distribution of meta-reasoning quality scores (0-1)',
    ['engine'] // engine: model_of_inference
  );

  metaConfidenceCounter = new CounterMetric(
    'plot_engine_meta_confidence_total',
    'Count of inference results by confidence level',
    ['engine', 'level'] // level: HIGH|MEDIUM|LOW
  );

  metaStabilityCounter = new CounterMetric(
    'plot_engine_meta_stability_total',
    'Count of inference results by estimate stability',
    ['engine', 'stability'] // stability: stable|moderate|volatile
  );

  metaConvergenceCounter = new CounterMetric(
    'plot_engine_meta_convergence_total',
    'Count of inference results by convergence status',
    ['engine', 'status'] // status: converged|marginal|not_converged
  );

  // P1: Observability header validation metrics
  payloadHashInvalidCounter = new CounterMetric(
    'plot_engine_payload_hash_invalid_total',
    'Total number of requests with malformed x-olumi-payload-hash header',
    [] // No labels - just count occurrences
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

// P1.3: Observe SLO latency by detail_level
export function observeSloLatency(
  detailLevel: 'quick' | 'standard' | 'deep',
  statusCode: number,
  durationMs: number
): void {
  if (!sloLatencyHistogram) return;

  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  sloLatencyHistogram.observe(
    { detail_level: detailLevel, status_class: statusClass },
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

// P1.1: ISL metrics recording functions
export function recordIslValidation(backend: 'isl' | 'fallback', result: 'ok' | 'error' | 'timeout'): void {
  islValidationCounter?.inc({ backend, result });
}

export function recordIslSensitivity(backend: 'isl' | 'fallback', result: 'ok' | 'error' | 'timeout'): void {
  islSensitivityCounter?.inc({ backend, result });
}

export function recordIslFactorSensitivity(backend: 'isl' | 'fallback', result: 'ok' | 'error' | 'timeout'): void {
  islFactorSensitivityCounter?.inc({ backend, result });
}

export function recordIslRobustnessAnalysis(
  backend: 'isl' | 'fallback',
  result: 'ok' | 'error' | 'timeout',
  edgeStatus: string,
  factorStatus: string
): void {
  islRobustnessAnalysisCounter?.inc({ backend, result, edge_status: edgeStatus, factor_status: factorStatus });
}

export function observeIslLatency(operation: 'validation' | 'sensitivity' | 'factor_sensitivity' | 'robustness_analysis', result: 'ok' | 'error', durationMs: number): void {
  islLatencyHistogram?.observe({ operation, result }, durationMs / 1000);
}

// Codex F8 handshake: record a compute-admission version-skew detection.
/**
 * ROADMAP 2.260 — the label type is IMPORTED from the resolver, not restated.
 * It used to be a hand-copied union here, i.e. a third copy of the same list
 * (trap 12): adding a skew reason left this signature silently narrower, and the
 * new reason could not be recorded. `import type` is erased at compile time, so
 * this creates no runtime import cycle with compute-admission.ts.
 */
export function recordIslAdmissionVersionSkew(reason: AdmissionSkewReason): void {
  islAdmissionVersionSkewCounter?.inc({ reason });
}

// Meta-reasoning quality metrics recording functions
export function observeMetaQuality(engine: string, score: number): void {
  metaQualityHistogram?.observe({ engine }, score);
}

export function recordMetaConfidence(engine: string, level: 'high' | 'medium' | 'low'): void {
  metaConfidenceCounter?.inc({ engine, level });
}

export function recordMetaStability(engine: string, stability: 'stable' | 'moderate' | 'volatile'): void {
  metaStabilityCounter?.inc({ engine, stability });
}

export function recordMetaConvergence(engine: string, status: 'converged' | 'marginal' | 'not_converged'): void {
  metaConvergenceCounter?.inc({ engine, status });
}

// P1: Record malformed payload hash header
export function recordPayloadHashInvalid(): void {
  payloadHashInvalidCounter?.inc();
}

/**
 * Record all meta-reasoning metrics from a model_of_inference result
 */
export function recordMetaReasoningMetrics(
  engine: string,
  quality: { overall_score: number; confidence_level: 'high' | 'medium' | 'low' },
  reliability: { estimate_stability: 'stable' | 'moderate' | 'volatile'; convergence_status: 'converged' | 'marginal' | 'not_converged' }
): void {
  observeMetaQuality(engine, quality.overall_score);
  recordMetaConfidence(engine, quality.confidence_level);
  recordMetaStability(engine, reliability.estimate_stability);
  recordMetaConvergence(engine, reliability.convergence_status);
}

export function renderHistograms(): string {
  const lines: string[] = [];

  if (requestDurationHistogram) {
    lines.push(requestDurationHistogram.render());
  }

  if (engineLatencyHistogram) {
    lines.push(engineLatencyHistogram.render());
  }

  // P1.3: Render SLO latency histogram
  if (sloLatencyHistogram) {
    lines.push(sloLatencyHistogram.render());
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

  // P1.1: Render ISL metrics
  if (islValidationCounter) {
    lines.push(islValidationCounter.render());
  }

  if (islSensitivityCounter) {
    lines.push(islSensitivityCounter.render());
  }

  if (islFactorSensitivityCounter) {
    lines.push(islFactorSensitivityCounter.render());
  }

  if (islRobustnessAnalysisCounter) {
    lines.push(islRobustnessAnalysisCounter.render());
  }

  if (islLatencyHistogram) {
    lines.push(islLatencyHistogram.render());
  }

  // Codex F8 handshake: compute-admission version-skew counter
  if (islAdmissionVersionSkewCounter) {
    lines.push(islAdmissionVersionSkewCounter.render());
  }

  // Meta-reasoning quality metrics
  if (metaQualityHistogram) {
    lines.push(metaQualityHistogram.render());
  }

  if (metaConfidenceCounter) {
    lines.push(metaConfidenceCounter.render());
  }

  if (metaStabilityCounter) {
    lines.push(metaStabilityCounter.render());
  }

  if (metaConvergenceCounter) {
    lines.push(metaConvergenceCounter.render());
  }

  // P1: Observability header validation metrics
  if (payloadHashInvalidCounter) {
    lines.push(payloadHashInvalidCounter.render());
  }

  return lines.join('\n');
}

export function resetHistograms(): void {
  requestDurationHistogram?.reset();
  engineLatencyHistogram?.reset();
  sloLatencyHistogram?.reset(); // P1.3
  rateLimitCounter?.reset();
  circuitOpenCounter?.reset();
  circuitProbesCounter?.reset();
  ceeAttemptedCounter?.reset();
  ceeOkCounter?.reset();
  ceeSkippedCounter?.reset();
  ceeDegradedCounter?.reset();
  // P1.1: Reset ISL metrics
  islValidationCounter?.reset();
  islSensitivityCounter?.reset();
  islFactorSensitivityCounter?.reset();
  islRobustnessAnalysisCounter?.reset();
  islLatencyHistogram?.reset();
  islAdmissionVersionSkewCounter?.reset();
  // Meta-reasoning quality metrics
  metaQualityHistogram?.reset();
  metaConfidenceCounter?.reset();
  metaStabilityCounter?.reset();
  metaConvergenceCounter?.reset();
  // P1: Observability header validation metrics
  payloadHashInvalidCounter?.reset();
}
