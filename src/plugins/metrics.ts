/**
 * Prometheus /metrics endpoint (C4)
 * Flag: PROMETHEUS_ENABLE=1
 */
import type { FastifyInstance } from 'fastify';
import { 
  getEngineP95Ms, 
  getEngineP95MsRolling,
  getIdemCacheSize,
  getJson429Count,
  getSse429Count,
  getStreamCanaryMetrics
} from '../metrics.js';
import { renderHistograms } from '../metrics/registry.js';
import { renderValidationMetrics } from '../observability/validationMetrics.js';
import { renderPrincipalSecretFallback } from '../observability/principalSecretMetrics.js';
import { renderStreamMetrics } from '../observability/streamMetrics.js';
import { renderIdempotencyMetrics } from '../observability/idempotencyMetrics.js';

export async function registerPrometheusMetrics(app: FastifyInstance) {
  if (process.env.PROMETHEUS_ENABLE !== '1') {
    return; // Skip registration
  }

  app.get('/metrics', async (_req, reply) => {
    const metrics = [];
    
    // P1: Histograms (request duration, engine latency)
    const histograms = renderHistograms();
    if (histograms) {
      metrics.push(histograms);
    }
    
    // Engine performance
    metrics.push(`# HELP engine_p95_ms Engine P95 latency in milliseconds`);
    metrics.push(`# TYPE engine_p95_ms gauge`);
    metrics.push(`engine_p95_ms ${getEngineP95Ms()}`);
    
    metrics.push(`# HELP engine_p95_ms_rolling Rolling P95 latency in milliseconds`);
    metrics.push(`# TYPE engine_p95_ms_rolling gauge`);
    metrics.push(`engine_p95_ms_rolling ${getEngineP95MsRolling()}`);
    
    // Rate limiting
    metrics.push(`# HELP json_429_total Total 429 responses for JSON endpoints`);
    metrics.push(`# TYPE json_429_total counter`);
    metrics.push(`json_429_total ${getJson429Count()}`);
    
    metrics.push(`# HELP sse_429_total Total 429 responses for SSE endpoints`);
    metrics.push(`# TYPE sse_429_total counter`);
    metrics.push(`sse_429_total ${getSse429Count()}`);
    
    // Idempotency
    metrics.push(`# HELP idem_cache_size Current idempotency cache size`);
    metrics.push(`# TYPE idem_cache_size gauge`);
    metrics.push(`idem_cache_size ${getIdemCacheSize()}`);
    
    // P0-1: Validation errors
    const validationMetrics = renderValidationMetrics();
    if (validationMetrics) {
      metrics.push(validationMetrics);
    }
    
    // P0-2: Principal secret fallback
    const secretFallback = renderPrincipalSecretFallback();
    if (secretFallback) {
      metrics.push(secretFallback);
    }
    
    // P1: Stream metrics (if STREAM_PARITY_ENABLE=1)
    if (process.env.STREAM_PARITY_ENABLE === '1') {
      const streamMetrics = renderStreamMetrics();
      if (streamMetrics) {
        metrics.push(streamMetrics);
      }
    }
    
    // P2: Idempotency metrics (if IDEMPOTENCY_ENABLE=1 or STREAM_RESUME_ENABLE=1)
    if (process.env.IDEMPOTENCY_ENABLE === '1' || process.env.STREAM_RESUME_ENABLE === '1') {
      const idempotencyMetrics = renderIdempotencyMetrics();
      if (idempotencyMetrics) {
        metrics.push(idempotencyMetrics);
      }
    }
    
    // P2-1: Stream canary metrics
    const canary = getStreamCanaryMetrics();
    metrics.push(`# HELP plot_engine_stream_canary_total Streams by enhanced mode status`);
    metrics.push(`# TYPE plot_engine_stream_canary_total counter`);
    metrics.push(`plot_engine_stream_canary_total{enabled="true",route="/v1/stream"} ${canary.stream_canary_enabled}`);
    metrics.push(`plot_engine_stream_canary_total{enabled="false",route="/v1/stream"} ${canary.stream_canary_disabled}`);
    
    metrics.push(`# HELP plot_engine_stream_deprecated_header_total Deprecated X-Stream-Enhanced header usage`);
    metrics.push(`# TYPE plot_engine_stream_deprecated_header_total counter`);
    metrics.push(`plot_engine_stream_deprecated_header_total{route="/v1/stream"} ${canary.stream_deprecated_header}`);
    
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return metrics.join('\n') + '\n';
  });
}
