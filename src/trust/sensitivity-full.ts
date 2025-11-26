/**
 * Full Sensitivity Analysis
 * Provides all edge sensitivities with HHI concentration index
 *
 * Sprint N Feature 2: Let users see all edge sensitivities, not just top 3
 */

import type { SensitivityEdge } from '../lib/sensitivity-simple.js';

/**
 * Concentration level based on HHI thresholds
 * - high: HHI ≥ 0.25 (few edges dominate)
 * - medium: 0.15 ≤ HHI < 0.25
 * - diffuse: HHI < 0.15 (impact spread evenly)
 */
export type ConcentrationLevel = 'high' | 'medium' | 'diffuse';

/**
 * Full sensitivity analysis result
 */
export interface FullSensitivity {
  /** All edges sorted by sensitivity score (descending) */
  edges: SensitivityEdge[];
  /** Herfindahl-Hirschman Index: sum of squared shares (0-1) */
  hhi: number;
  /** Concentration level based on HHI thresholds */
  concentration: ConcentrationLevel;
  /** Number of edges that explain ≥80% of total sensitivity */
  edges_to_80pct: number;
  /** Total sensitivity score across all edges */
  total_score: number;
  /** Interpretation string for UI display */
  interpretation: string;
}

/**
 * HHI thresholds for concentration classification
 */
const HHI_HIGH_THRESHOLD = 0.25;
const HHI_MEDIUM_THRESHOLD = 0.15;

/**
 * Target coverage percentage for edges_to_80pct calculation
 */
const COVERAGE_TARGET = 0.80;

/**
 * Compute Herfindahl-Hirschman Index from edge sensitivity scores
 *
 * HHI = Σ(share_i²) where share_i = score_i / total_score
 *
 * @param edges - Array of edges with sensitivity scores
 * @returns HHI value between 0 and 1
 */
export function computeHHI(edges: SensitivityEdge[]): number {
  if (edges.length === 0) return 0;

  const totalScore = edges.reduce((sum, e) => sum + e.score, 0);

  if (totalScore === 0) return 0;

  // Sum of squared shares
  const hhi = edges.reduce((sum, e) => {
    const share = e.score / totalScore;
    return sum + share * share;
  }, 0);

  // Round to avoid floating point artifacts
  return Math.round(hhi * 10000) / 10000;
}

/**
 * Classify concentration level based on HHI
 */
export function classifyConcentration(hhi: number): ConcentrationLevel {
  if (hhi >= HHI_HIGH_THRESHOLD) return 'high';
  if (hhi >= HHI_MEDIUM_THRESHOLD) return 'medium';
  return 'diffuse';
}

/**
 * Count edges needed to reach target coverage percentage
 *
 * @param edges - Array of edges sorted by score descending
 * @param totalScore - Total score across all edges
 * @param target - Target coverage percentage (default 0.80 = 80%)
 * @returns Number of edges needed to reach target coverage
 */
export function countEdgesToCoverage(
  edges: SensitivityEdge[],
  totalScore: number,
  target: number = COVERAGE_TARGET
): number {
  if (edges.length === 0 || totalScore === 0) return 0;

  let accumulated = 0;
  let count = 0;

  for (const edge of edges) {
    accumulated += edge.score;
    count++;
    if (accumulated / totalScore >= target) break;
  }

  return count;
}

/**
 * Generate human-readable interpretation of sensitivity analysis
 */
export function generateInterpretation(
  concentration: ConcentrationLevel,
  edgesTo80: number,
  totalEdges: number
): string {
  const pct = totalEdges > 0 ? Math.round((edgesTo80 / totalEdges) * 100) : 0;

  switch (concentration) {
    case 'high':
      return `High concentration: ${edgesTo80} edge${edgesTo80 !== 1 ? 's' : ''} (${pct}%) explain 80% of model sensitivity. Focus validation on these critical relationships.`;
    case 'medium':
      return `Moderate concentration: ${edgesTo80} edge${edgesTo80 !== 1 ? 's' : ''} (${pct}%) explain 80% of model sensitivity. Review both high-impact and supporting edges.`;
    case 'diffuse':
      return `Diffuse sensitivity: ${edgesTo80} edge${edgesTo80 !== 1 ? 's' : ''} (${pct}%) needed to explain 80% of model sensitivity. Impact is broadly distributed.`;
  }
}

/**
 * Compute full sensitivity analysis with HHI concentration
 *
 * @param edges - Array of edges with sensitivity scores (already sorted by score descending)
 * @returns Full sensitivity analysis with HHI and interpretation
 */
export function computeFullSensitivity(edges: SensitivityEdge[]): FullSensitivity {
  // Ensure edges are sorted by score descending
  const sorted = [...edges].sort((a, b) => b.score - a.score);

  const totalScore = sorted.reduce((sum, e) => sum + e.score, 0);
  const hhi = computeHHI(sorted);
  const concentration = classifyConcentration(hhi);
  const edgesTo80 = countEdgesToCoverage(sorted, totalScore);

  return {
    edges: sorted,
    hhi,
    concentration,
    edges_to_80pct: edgesTo80,
    total_score: Math.round(totalScore * 10000) / 10000,
    interpretation: generateInterpretation(concentration, edgesTo80, sorted.length),
  };
}
