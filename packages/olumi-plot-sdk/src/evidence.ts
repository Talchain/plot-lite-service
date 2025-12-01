export type EvidenceFreshnessBucket = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface EvidenceFreshness {
  age_days: number | null;
  bucket: EvidenceFreshnessBucket;
}

export interface EvidenceSample {
  id?: string;
  observedAt?: string | Date | null;
}

export interface EvidenceFreshnessThresholds {
  /**
   * Days since observation considered "fresh" (inclusive).
   * Defaults to 90 days.
   */
  freshDays?: number;
  /**
   * Days since observation considered "stale" (inclusive).
   * Defaults to 365 days.
   */
  staleDays?: number;
  /**
   * Optional clock override for deterministic testing.
   */
  now?: Date;
}

export interface EvidenceFreshnessSummary {
  total: number;
  with_timestamp: number;
  oldest_days: number | null;
  newest_days: number | null;
  buckets: Record<EvidenceFreshnessBucket, number>;
}

/**
 * Classify a single evidence item into FRESH / AGING / STALE / UNKNOWN buckets
 * based on its observation time.
 */
export function classifyEvidenceFreshness(
  observedAt: string | Date | null | undefined,
  thresholds: EvidenceFreshnessThresholds = {},
): EvidenceFreshness {
  const freshDays = Number.isFinite(thresholds.freshDays) ? Number(thresholds.freshDays) : 90;
  const staleDays = Number.isFinite(thresholds.staleDays) ? Number(thresholds.staleDays) : 365;
  const now = thresholds.now instanceof Date ? thresholds.now : new Date();

  const result: EvidenceFreshness = {
    age_days: null,
    bucket: 'UNKNOWN',
  };

  if (!observedAt) return result;

  const ts = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(ts.getTime())) {
    return result;
  }

  const diffMs = now.getTime() - ts.getTime();
  const ageDays = diffMs <= 0 ? 0 : Math.floor(diffMs / (24 * 60 * 60 * 1000));

  result.age_days = ageDays;

  if (ageDays <= freshDays) {
    result.bucket = 'FRESH';
  } else if (ageDays >= staleDays) {
    result.bucket = 'STALE';
  } else {
    result.bucket = 'AGING';
  }

  return result;
}

/**
 * Summarise freshness across a collection of evidence samples.
 */
export function summarizeEvidenceFreshness(
  samples: EvidenceSample[],
  thresholds: EvidenceFreshnessThresholds = {},
): EvidenceFreshnessSummary {
  const buckets: Record<EvidenceFreshnessBucket, number> = {
    FRESH: 0,
    AGING: 0,
    STALE: 0,
    UNKNOWN: 0,
  };

  let total = 0;
  let withTimestamp = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const sample of samples) {
    total += 1;
    const freshness = classifyEvidenceFreshness(sample.observedAt, thresholds);
    buckets[freshness.bucket] += 1;

    if (freshness.age_days != null) {
      withTimestamp += 1;
      if (oldest == null || freshness.age_days > oldest) oldest = freshness.age_days;
      if (newest == null || freshness.age_days < newest) newest = freshness.age_days;
    }
  }

  return {
    total,
    with_timestamp: withTimestamp,
    oldest_days: oldest,
    newest_days: newest,
    buckets,
  };
}
