/**
 * Confidence Badge - LOW / MEDIUM / HIGH with reason
 */

import type { ConfidenceBadge, ConfidenceLevel, Graph } from './types.js';

export interface ConfidenceInputs {
  graph: Graph;
  identifiable: boolean;
  in_linear_range: boolean;
  k_samples?: number;
  calibrated?: boolean;
}

/**
 * Calculate confidence score based on graph quality and coverage
 */
export function calculateConfidence(inputs: ConfidenceInputs): ConfidenceBadge {
  const {
    graph,
    identifiable,
    in_linear_range,
    k_samples = 1000,
    calibrated = false,
  } = inputs;

  const node_count = graph.nodes.length;
  const edge_count = graph.edges.length;

  // Factor 1: Identifiability (0-1)
  const identifiability_score = identifiable ? 1.0 : 0.3;

  // Factor 2: Linearity distance (0-1)
  const linearity_score = in_linear_range ? 1.0 : 0.5;

  // Factor 3: K-coverage (0-1)
  // Good coverage: k >= 1000, Medium: 500-999, Low: < 500
  let k_coverage_score = 0.5;
  if (k_samples >= 1000) k_coverage_score = 1.0;
  else if (k_samples >= 500) k_coverage_score = 0.7;
  else k_coverage_score = 0.3;

  // Factor 4: Calibration (stub - always 0.5 for now)
  const calibration_score = calibrated ? 1.0 : 0.5;

  // Overall score (weighted average)
  const overall_score =
    identifiability_score * 0.35 +
    linearity_score * 0.25 +
    k_coverage_score * 0.25 +
    calibration_score * 0.15;

  // Determine level
  let level: ConfidenceLevel;
  let reason: string;

  if (overall_score >= 0.75) {
    level = 'HIGH';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: true,
    });
  } else if (overall_score >= 0.5) {
    level = 'MEDIUM';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: null,
    });
  } else {
    level = 'LOW';
    reason = buildReason({
      identifiable,
      node_count,
      edge_count,
      in_linear_range,
      k_samples,
      positive: false,
    });
  }

  // Invariant: level must be UPPERCASE only
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(level)) {
    throw new Error(`Invalid confidence.level: ${level}`);
  }

  return {
    level,
    reason,
    score: Math.round(overall_score * 100) / 100,
    factors: {
      identifiability: identifiability_score,
      linearity_distance: linearity_score,
      k_coverage: k_coverage_score,
      calibration: calibration_score,
    },
  };
}

interface ReasonInputs {
  identifiable: boolean;
  node_count: number;
  edge_count: number;
  in_linear_range: boolean;
  k_samples: number;
  positive: boolean | null; // true = HIGH, null = MEDIUM, false = LOW
}

function buildReason(inputs: ReasonInputs): string {
  const { identifiable, node_count, edge_count, in_linear_range, k_samples, positive } = inputs;

  if (positive === true) {
    return `Strong identifiability, ${node_count} nodes well-connected, within linear range, k=${k_samples}`;
  }

  if (positive === null) {
    const issues: string[] = [];
    if (!identifiable) issues.push('weak identifiability');
    if (!in_linear_range) issues.push('outside linear range');
    if (k_samples < 1000) issues.push(`limited samples (k=${k_samples})`);
    if (node_count < 6) issues.push(`sparse graph (${node_count} nodes)`);

    return issues.length > 0
      ? `Acceptable but ${issues.join(', ')}`
      : `${node_count} nodes, k=${k_samples}, identifiable`;
  }

  // LOW confidence
  const blockers: string[] = [];
  if (!identifiable) blockers.push('not identifiable');
  if (node_count < 4) blockers.push(`too few nodes (${node_count})`);
  if (edge_count < node_count - 1) blockers.push('disconnected graph');
  if (k_samples < 500) blockers.push(`insufficient samples (k=${k_samples})`);

  return blockers.length > 0
    ? `Low confidence: ${blockers.join(', ')}`
    : 'Limited evidence for robust inference';
}
