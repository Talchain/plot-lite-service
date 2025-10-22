/**
 * Enhanced metrics for /v1/stream endpoint
 * Follows existing in-house Prometheus text pattern
 */

let streamClientsOpen = 0;
let streamClientsClosed = 0;
let streamBackpressureDrops = 0;
let streamHeartbeatTotal = 0;
let streamCircuitRejected = 0;
const streamDurations: number[] = [];

// Token metrics (bounded labels)
const tokenIssuedByAudience = new Map<string, number>();
const tokenRedeemedByAudience = new Map<string, number>();
const tokenRejectByReason = new Map<string, number>();

export function incStreamClientsOpen(): void {
  streamClientsOpen++;
}

export function incStreamClientsClosed(): void {
  streamClientsClosed++;
  streamClientsOpen = Math.max(0, streamClientsOpen - 1);
}

export function incStreamBackpressureDrop(reason: 'overflow' | 'slow_client'): void {
  streamBackpressureDrops++;
}

export function incStreamHeartbeat(): void {
  streamHeartbeatTotal++;
}

export function incStreamCircuitRejected(): void {
  streamCircuitRejected++;
}

export function recordStreamDuration(ms: number): void {
  streamDurations.push(ms);
  // Keep only last 1000 samples to prevent unbounded growth
  if (streamDurations.length > 1000) {
    streamDurations.shift();
  }
}

export function incStreamTokenIssued(audience: string): void {
  tokenIssuedByAudience.set(audience, (tokenIssuedByAudience.get(audience) || 0) + 1);
}

export function incStreamTokenRedeemed(audience: string): void {
  tokenRedeemedByAudience.set(audience, (tokenRedeemedByAudience.get(audience) || 0) + 1);
}

export function incStreamTokenReject(reason: string): void {
  tokenRejectByReason.set(reason, (tokenRejectByReason.get(reason) || 0) + 1);
}

export function renderStreamMetrics(): string {
  // Calculate histogram buckets for duration
  const p50 = percentile(streamDurations, 0.5);
  const p95 = percentile(streamDurations, 0.95);
  const p99 = percentile(streamDurations, 0.99);

  return `
# HELP plot_engine_stream_clients Active stream connections
# TYPE plot_engine_stream_clients gauge
plot_engine_stream_clients{state="open"} ${streamClientsOpen}
plot_engine_stream_clients{state="closed"} ${streamClientsClosed}

# HELP plot_engine_stream_backpressure_drops_total Events dropped due to backpressure
# TYPE plot_engine_stream_backpressure_drops_total counter
plot_engine_stream_backpressure_drops_total ${streamBackpressureDrops}

# HELP plot_engine_stream_heartbeat_total Heartbeats sent
# TYPE plot_engine_stream_heartbeat_total counter
plot_engine_stream_heartbeat_total ${streamHeartbeatTotal}

# HELP plot_engine_stream_circuit_rejected_total Streams rejected by circuit breaker
# TYPE plot_engine_stream_circuit_rejected_total counter
plot_engine_stream_circuit_rejected_total ${streamCircuitRejected}

# HELP plot_engine_stream_duration_ms Stream duration in milliseconds
# TYPE plot_engine_stream_duration_ms summary
plot_engine_stream_duration_ms{quantile="0.5"} ${p50}
plot_engine_stream_duration_ms{quantile="0.95"} ${p95}
plot_engine_stream_duration_ms{quantile="0.99"} ${p99}
plot_engine_stream_duration_ms_count ${streamDurations.length}

# HELP plot_engine_stream_token_issued_total Tokens issued
# TYPE plot_engine_stream_token_issued_total counter
${Array.from(tokenIssuedByAudience.entries()).map(([aud, count]) => 
  `plot_engine_stream_token_issued_total{audience="${aud}"} ${count}`
).join('\n')}

# HELP plot_engine_stream_token_redeemed_total Tokens redeemed
# TYPE plot_engine_stream_token_redeemed_total counter
${Array.from(tokenRedeemedByAudience.entries()).map(([aud, count]) => 
  `plot_engine_stream_token_redeemed_total{audience="${aud}"} ${count}`
).join('\n')}

# HELP plot_engine_stream_token_reject_total Token rejections
# TYPE plot_engine_stream_token_reject_total counter
${Array.from(tokenRejectByReason.entries()).map(([reason, count]) => 
  `plot_engine_stream_token_reject_total{reason="${reason}"} ${count}`
).join('\n')}
`.trim();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] || 0;
}
