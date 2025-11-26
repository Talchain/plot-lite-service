/**
 * Insights Block
 *
 * Generates human-readable insights from inference results.
 * No user content is included - only computed metrics and recommendations.
 */

export interface Insights {
  summary: string; // ≤200 chars
  risks: string[]; // max 5, each ≤100 chars
  next_steps: string[]; // max 3, each ≤150 chars
}

export interface InsightsParams {
  p10: number;
  p50: number;
  p90: number;
  baseline: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  critique_blockers: number;
  critique_warnings: number;
  evidence_coverage: number;
  top_driver_label?: string;
}

/**
 * Generate insights from inference results
 *
 * @param params Inference metrics and quality indicators
 * @returns Insights block with summary, risks, and next_steps
 */
export function generateInsights(params: InsightsParams): Insights {
  const {
    p10,
    p50,
    p90,
    baseline,
    confidence_level,
    critique_blockers,
    critique_warnings,
    evidence_coverage,
    top_driver_label,
  } = params;

  // Calculate delta
  const delta = p50 - baseline;
  const deltaPct =
    baseline !== 0 ? Math.round((delta / Math.abs(baseline)) * 100) : 0;
  const direction = delta >= 0 ? 'increase' : 'decrease';
  const absDeltaPct = Math.abs(deltaPct);

  // Calculate range
  const rangeLowPct =
    baseline !== 0
      ? Math.round(((p10 - baseline) / Math.abs(baseline)) * 100)
      : 0;
  const rangeHighPct =
    baseline !== 0
      ? Math.round(((p90 - baseline) / Math.abs(baseline)) * 100)
      : 0;

  // Build summary (≤200 chars)
  const confLabel = confidence_level.toLowerCase();
  let summary = `Outcome likely to ${direction} by ${absDeltaPct}% (range: ${rangeLowPct}% to ${rangeHighPct}%) with ${confLabel} confidence.`;

  // Truncate if needed
  if (summary.length > 200) {
    summary = summary.slice(0, 197) + '...';
  }

  // Build risks (max 5, each ≤100 chars)
  const risks: string[] = [];

  if (critique_blockers > 0) {
    risks.push(
      truncate(`${critique_blockers} critical issue(s) require resolution`, 100)
    );
  }

  if (critique_warnings > 0) {
    risks.push(
      truncate(`${critique_warnings} warning(s) may affect reliability`, 100)
    );
  }

  if (evidence_coverage < 0.3) {
    risks.push(
      truncate(
        `Low evidence coverage (${Math.round(evidence_coverage * 100)}%) - key assumptions unverified`,
        100
      )
    );
  } else if (evidence_coverage < 0.5) {
    risks.push(
      truncate(
        `Moderate evidence coverage (${Math.round(evidence_coverage * 100)}%) - some relationships unverified`,
        100
      )
    );
  }

  if (confidence_level === 'LOW') {
    risks.push(truncate('Low confidence indicates high uncertainty', 100));
  }

  // Wide uncertainty range
  const rangeSpread = Math.abs(rangeHighPct - rangeLowPct);
  if (rangeSpread > 50) {
    risks.push(
      truncate(
        `Wide outcome range (${rangeSpread}% spread) suggests high variability`,
        100
      )
    );
  }

  // Build next_steps (max 3, each ≤150 chars)
  const next_steps: string[] = [];

  if (critique_blockers > 0) {
    next_steps.push(
      truncate('Address critical issues before using for decisions', 150)
    );
  }

  if (evidence_coverage < 0.5 && next_steps.length < 3) {
    next_steps.push(
      truncate('Add evidence to strengthen key relationship assumptions', 150)
    );
  }

  if (top_driver_label && next_steps.length < 3) {
    next_steps.push(
      truncate(
        `Focus validation on "${top_driver_label}" - primary outcome driver`,
        150
      )
    );
  }

  if (confidence_level === 'MEDIUM' && next_steps.length < 3) {
    next_steps.push(
      truncate('Review warnings to increase confidence level', 150)
    );
  }

  if (next_steps.length === 0) {
    next_steps.push(truncate('Model ready for decision support', 150));
  }

  return {
    summary,
    risks: risks.slice(0, 5),
    next_steps: next_steps.slice(0, 3),
  };
}

/**
 * Truncate string to max length, adding ellipsis if needed
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
