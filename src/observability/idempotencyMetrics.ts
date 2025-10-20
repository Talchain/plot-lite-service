/**
 * P2: Idempotency & Stream Resume Metrics
 */

let idempotencyHits = 0;
let idempotencyMisses = 0;
let idempotencyEvictionsTTL = 0;
let idempotencyEvictionsCapacity = 0;

let streamResumeHit = 0;
let streamResumeMiss = 0;
let streamResumeExpired = 0;
let streamResumeOverflow = 0;

export function incIdempotencyHits(route: string): void {
  idempotencyHits++;
}

export function incIdempotencyMisses(route: string): void {
  idempotencyMisses++;
}

export function incIdempotencyEvictions(reason: 'ttl' | 'capacity'): void {
  if (reason === 'ttl') {
    idempotencyEvictionsTTL++;
  } else {
    idempotencyEvictionsCapacity++;
  }
}

export function incStreamResume(result: 'hit' | 'miss' | 'expired' | 'overflow'): void {
  switch (result) {
    case 'hit':
      streamResumeHit++;
      break;
    case 'miss':
      streamResumeMiss++;
      break;
    case 'expired':
      streamResumeExpired++;
      break;
    case 'overflow':
      streamResumeOverflow++;
      break;
  }
}

export function renderIdempotencyMetrics(): string {
  return `
# HELP plot_engine_idempotency_hits_total Idempotency cache hits
# TYPE plot_engine_idempotency_hits_total counter
plot_engine_idempotency_hits_total{route="/v1/run"} ${idempotencyHits}

# HELP plot_engine_idempotency_misses_total Idempotency cache misses
# TYPE plot_engine_idempotency_misses_total counter
plot_engine_idempotency_misses_total{route="/v1/run"} ${idempotencyMisses}

# HELP plot_engine_idempotency_evictions_total Cache evictions
# TYPE plot_engine_idempotency_evictions_total counter
plot_engine_idempotency_evictions_total{reason="ttl"} ${idempotencyEvictionsTTL}
plot_engine_idempotency_evictions_total{reason="capacity"} ${idempotencyEvictionsCapacity}

# HELP plot_engine_stream_resume_total Stream resume attempts
# TYPE plot_engine_stream_resume_total counter
plot_engine_stream_resume_total{result="hit"} ${streamResumeHit}
plot_engine_stream_resume_total{result="miss"} ${streamResumeMiss}
plot_engine_stream_resume_total{result="expired"} ${streamResumeExpired}
plot_engine_stream_resume_total{result="overflow"} ${streamResumeOverflow}
`.trim();
}
