// Evidence freshness helpers for PLoT Engine
// Mirrors the semantics of the @olumi/plot-sdk helpers but operates on
// engine evidence items (which may optionally include a timestamp field).

export type EvidenceFreshnessBucket = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface EvidenceFreshness {
  age_days: number | null;
  bucket: EvidenceFreshnessBucket;
}

export interface EvidenceFreshnessSummary {
  total: number;
  with_timestamp: number;
  oldest_days: number | null;
  newest_days: number | null;
  buckets: Record<EvidenceFreshnessBucket, number>;
}

// Internal helper: classify a single timestamp into a freshness bucket.
function classifyFromTimestamp(
  observedAt: string | null | undefined,
  nowOverride?: Date,
): EvidenceFreshness {
  const freshDays = 90;
  const staleDays = 365;
  const now = nowOverride ?? new Date();

  const result: EvidenceFreshness = {
    age_days: null,
    bucket: 'UNKNOWN',
  };

  if (!observedAt) return result;

  const ts = new Date(observedAt);
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

export interface EvidenceWithOptionalTimestamp {
  timestamp?: string | null;
}

/**
 * Summarise evidence freshness for an array of evidence items.
 * Evidence items may optionally include a `timestamp` ISO string.
 */
export function summarizeEvidenceFreshnessFromEvidence(
  evidence: EvidenceWithOptionalTimestamp[],
  nowOverride?: Date,
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

  for (const item of evidence) {
    total += 1;
    const freshness = classifyFromTimestamp(item.timestamp, nowOverride);
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
