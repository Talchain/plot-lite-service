/**
 * Insights Block
 *
 * Generates human-readable insights from inference results.
 * No user content is included - only computed metrics and recommendations.
 */

import type {
  StructuredInsight,
  StructuredInsights,
  NodeReference,
} from '../types/structured-insights.js';
import {
  createNodeInsight,
} from '../util/insight-references.js';
import type { GraphNode } from './types.js';

export interface Insights {
  summary: string; // ≤200 chars
  risks: string[]; // max 5, each ≤100 chars
  next_steps: string[]; // max 3, each ≤150 chars
}

export type { StructuredInsight, StructuredInsights, NodeReference };

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

/** Internal computed metrics used by insight generation */
interface InsightMetrics {
  delta: number;
  deltaPct: number;
  direction: 'increase' | 'decrease';
  absDeltaPct: number;
  rangeLowPct: number;
  rangeHighPct: number;
  rangeSpread: number;
}

/**
 * Compute insight metrics from params (shared by both insight generators)
 */
function computeMetrics(params: InsightsParams): InsightMetrics {
  const { p10, p50, p90, baseline } = params;

  const delta = p50 - baseline;
  const deltaPct =
    baseline !== 0 ? Math.round((delta / Math.abs(baseline)) * 100) : 0;
  const direction = delta >= 0 ? 'increase' : 'decrease';
  const absDeltaPct = Math.abs(deltaPct);

  const rangeLowPct =
    baseline !== 0
      ? Math.round(((p10 - baseline) / Math.abs(baseline)) * 100)
      : 0;
  const rangeHighPct =
    baseline !== 0
      ? Math.round(((p90 - baseline) / Math.abs(baseline)) * 100)
      : 0;

  const rangeSpread = Math.abs(rangeHighPct - rangeLowPct);

  return {
    delta,
    deltaPct,
    direction,
    absDeltaPct,
    rangeLowPct,
    rangeHighPct,
    rangeSpread,
  };
}

/**
 * Build summary string from metrics (shared by both insight generators)
 */
function buildSummary(
  metrics: InsightMetrics,
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW'
): string {
  const { direction, absDeltaPct, rangeLowPct, rangeHighPct } = metrics;
  const confLabel = confidence_level.toLowerCase();
  const rangeText =
    rangeLowPct === rangeHighPct
      ? `${rangeLowPct}%`
      : `${rangeLowPct}% to ${rangeHighPct}%`;

  let summary = `Outcome likely to ${direction} by ${absDeltaPct}% (range: ${rangeText}) with ${confLabel} confidence.`;

  if (summary.length > 200) {
    summary = summary.slice(0, 197) + '...';
  }

  return summary;
}

/**
 * Build risks array from params and metrics (shared by both insight generators)
 */
function buildRisks(
  params: InsightsParams,
  metrics: InsightMetrics
): string[] {
  const { critique_blockers, critique_warnings, evidence_coverage, confidence_level } = params;
  const { rangeSpread } = metrics;

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

  if (rangeSpread > 50) {
    risks.push(
      truncate(
        `Wide outcome range (${rangeSpread}% spread) suggests high variability`,
        100
      )
    );
  }

  return risks.slice(0, 5);
}

/**
 * Truncate string to max length, adding ellipsis if needed
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Build next_steps array from params (shared logic for string-only outputs)
 */
function buildNextSteps(params: InsightsParams): string[] {
  const { critique_blockers, evidence_coverage, confidence_level, top_driver_label } = params;
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

  return next_steps.slice(0, 3);
}

/**
 * Generate insights from inference results
 *
 * @param params Inference metrics and quality indicators
 * @returns Insights block with summary, risks, and next_steps
 */
export function generateInsights(params: InsightsParams): Insights {
  const metrics = computeMetrics(params);
  const summary = buildSummary(metrics, params.confidence_level);
  const risks = buildRisks(params, metrics);
  const next_steps = buildNextSteps(params);

  return { summary, risks, next_steps };
}

/**
 * Extended parameters for structured insights generation
 */
export interface StructuredInsightsParams extends InsightsParams {
  /** Top driver node ID (for structured reference) */
  top_driver_node_id?: string;
  /** Graph nodes for label resolution */
  graph_nodes?: GraphNode[];
}

/**
 * Build structured next_steps array with optional node references
 */
function buildStructuredNextSteps(
  params: StructuredInsightsParams,
  graph_nodes: GraphNode[]
): Array<string | StructuredInsight> {
  const { critique_blockers, evidence_coverage, confidence_level, top_driver_label, top_driver_node_id } = params;
  const next_steps: Array<string | StructuredInsight> = [];

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

  // Use structured insight with node reference for top driver
  if (top_driver_node_id && graph_nodes.length > 0 && next_steps.length < 3) {
    const structuredInsight = createNodeInsight(
      'Focus validation on this primary outcome driver',
      [top_driver_node_id],
      graph_nodes
    );
    // Only add if we successfully resolved the node reference
    if (structuredInsight.node_references && structuredInsight.node_references.length > 0) {
      next_steps.push(structuredInsight);
    } else if (top_driver_label) {
      // Fall back to string if node reference couldn't be resolved
      next_steps.push(
        truncate(
          `Focus validation on "${top_driver_label}" - primary outcome driver`,
          150
        )
      );
    }
  } else if (top_driver_label && next_steps.length < 3) {
    // Fall back to original string format if no node ID provided
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

  return next_steps.slice(0, 3);
}

/**
 * Generate structured insights with node/edge references
 *
 * Returns insights with structured references that UI can use for
 * highlighting, navigation, and interaction with graph elements.
 *
 * @param params Inference metrics, quality indicators, and graph context
 * @returns Structured insights with node references
 */
export function generateStructuredInsights(
  params: StructuredInsightsParams
): StructuredInsights {
  const { graph_nodes = [] } = params;

  const metrics = computeMetrics(params);
  const summary = buildSummary(metrics, params.confidence_level);
  const risks = buildRisks(params, metrics);
  const next_steps = buildStructuredNextSteps(params, graph_nodes);

  return { summary, risks, next_steps };
}
