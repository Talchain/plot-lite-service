/**
 * Sampling Performance Metrics
 *
 * Brief 8: Task 8 - Performance Monitoring
 *
 * Instrumentation for:
 * - Samples per second
 * - Cache hit rate
 * - Time breakdown: sampling vs propagation vs aggregation
 * - Memory usage
 *
 * Expose via /v1/metrics or /v1/simulate/metrics
 */

import type { SamplingMetrics } from './types.js';
import { getTraceCache } from './trace-cache.js';
import { SAMPLING_CONFIG_VERSION } from './types.js';

/**
 * Timing data for a single simulation run
 */
interface SimulationTiming {
  /** Timestamp when simulation started */
  start_time: number;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Number of samples generated */
  n_samples: number;
  /** Time spent sampling edge masks and weights */
  sampling_ms: number;
  /** Time spent in forward propagation */
  propagation_ms: number;
  /** Time spent computing aggregates */
  aggregation_ms: number;
}

/**
 * Rolling window size for metrics
 */
const WINDOW_SIZE = 100;

/**
 * Metrics collector
 */
class MetricsCollector {
  private timings: SimulationTiming[] = [];
  private totalSamples = 0;
  private totalTimeMs = 0;

  /**
   * Record a simulation run
   */
  record(timing: SimulationTiming): void {
    this.timings.push(timing);
    this.totalSamples += timing.n_samples;
    this.totalTimeMs += timing.duration_ms;

    // Keep only recent timings
    while (this.timings.length > WINDOW_SIZE) {
      const removed = this.timings.shift()!;
      this.totalSamples -= removed.n_samples;
      this.totalTimeMs -= removed.duration_ms;
    }
  }

  /**
   * Get average samples per second
   */
  getSamplesPerSecond(): number {
    if (this.totalTimeMs <= 0) return 0;
    return (this.totalSamples / this.totalTimeMs) * 1000;
  }

  /**
   * Get average time breakdown
   */
  getTimeBreakdown(): { sampling_ms: number; propagation_ms: number; aggregation_ms: number } {
    if (this.timings.length === 0) {
      return { sampling_ms: 0, propagation_ms: 0, aggregation_ms: 0 };
    }

    const total = this.timings.reduce(
      (acc, t) => ({
        sampling_ms: acc.sampling_ms + t.sampling_ms,
        propagation_ms: acc.propagation_ms + t.propagation_ms,
        aggregation_ms: acc.aggregation_ms + t.aggregation_ms,
      }),
      { sampling_ms: 0, propagation_ms: 0, aggregation_ms: 0 }
    );

    const n = this.timings.length;
    return {
      sampling_ms: total.sampling_ms / n,
      propagation_ms: total.propagation_ms / n,
      aggregation_ms: total.aggregation_ms / n,
    };
  }

  /**
   * Get p95 latency
   */
  getP95LatencyMs(): number {
    if (this.timings.length === 0) return 0;

    const sorted = [...this.timings].sort((a, b) => a.duration_ms - b.duration_ms);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(idx, sorted.length - 1)].duration_ms;
  }

  /**
   * Get median latency
   */
  getMedianLatencyMs(): number {
    if (this.timings.length === 0) return 0;

    const sorted = [...this.timings].sort((a, b) => a.duration_ms - b.duration_ms);
    const idx = Math.floor(sorted.length * 0.5);
    return sorted[idx].duration_ms;
  }

  /**
   * Get number of recorded simulations
   */
  getCount(): number {
    return this.timings.length;
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.timings = [];
    this.totalSamples = 0;
    this.totalTimeMs = 0;
  }
}

/**
 * Singleton metrics collector
 */
let collector: MetricsCollector | null = null;

/**
 * Get the metrics collector
 */
function getCollector(): MetricsCollector {
  if (!collector) {
    collector = new MetricsCollector();
  }
  return collector;
}

/**
 * Record simulation timing
 */
export function recordSimulationTiming(timing: SimulationTiming): void {
  getCollector().record(timing);
}

/**
 * Get comprehensive sampling metrics
 */
export function getComprehensiveSamplingMetrics(): SamplingMetrics & {
  p95_latency_ms: number;
  median_latency_ms: number;
  simulation_count: number;
  cache: {
    hits: number;
    misses: number;
    evictions: number;
    hit_rate: number;
    size: number;
    max_size: number;
  };
  config: {
    sampling_config_version: string;
    trace_caching_enabled: boolean;
  };
} {
  const collector = getCollector();
  const cache = getTraceCache();
  const cacheStats = cache.getStats();

  return {
    samples_per_second: collector.getSamplesPerSecond(),
    cache_hit_rate: cacheStats.hit_rate,
    time_breakdown: collector.getTimeBreakdown(),
    memory_usage_bytes: cache.estimatedMemoryBytes(),
    p95_latency_ms: collector.getP95LatencyMs(),
    median_latency_ms: collector.getMedianLatencyMs(),
    simulation_count: collector.getCount(),
    cache: cacheStats,
    config: {
      sampling_config_version: SAMPLING_CONFIG_VERSION,
      trace_caching_enabled: cache.isEnabled(),
    },
  };
}

/**
 * Reset all metrics
 */
export function resetSamplingMetrics(): void {
  getCollector().reset();
}

/**
 * Timing helper for instrumentation
 */
export class SimulationTimer {
  private startTime: number;
  private samplingTime = 0;
  private propagationTime = 0;
  private aggregationTime = 0;
  private nSamples = 0;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Record sampling phase duration
   */
  recordSampling(durationMs: number): void {
    this.samplingTime += durationMs;
  }

  /**
   * Record propagation phase duration
   */
  recordPropagation(durationMs: number): void {
    this.propagationTime += durationMs;
  }

  /**
   * Record aggregation phase duration
   */
  recordAggregation(durationMs: number): void {
    this.aggregationTime += durationMs;
  }

  /**
   * Set number of samples
   */
  setNumSamples(n: number): void {
    this.nSamples = n;
  }

  /**
   * Finish timing and record to metrics
   */
  finish(): SimulationTiming {
    const endTime = performance.now();
    const timing: SimulationTiming = {
      start_time: this.startTime,
      duration_ms: endTime - this.startTime,
      n_samples: this.nSamples,
      sampling_ms: this.samplingTime,
      propagation_ms: this.propagationTime,
      aggregation_ms: this.aggregationTime,
    };

    recordSimulationTiming(timing);
    return timing;
  }
}

/**
 * Create a new simulation timer
 */
export function createSimulationTimer(): SimulationTimer {
  return new SimulationTimer();
}

/**
 * Estimate memory usage of an object
 * Rough approximation based on JSON size
 */
export function estimateMemoryUsage(obj: unknown): number {
  try {
    const json = JSON.stringify(obj);
    return json.length * 2; // UTF-16 encoding
  } catch {
    return 0;
  }
}

/**
 * Get process memory stats (if available)
 */
export function getProcessMemoryStats(): {
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  rss_mb: number;
} | null {
  try {
    const usage = process.memoryUsage();
    return {
      heap_used_mb: usage.heapUsed / 1024 / 1024,
      heap_total_mb: usage.heapTotal / 1024 / 1024,
      external_mb: usage.external / 1024 / 1024,
      rss_mb: usage.rss / 1024 / 1024,
    };
  } catch {
    return null;
  }
}
