/**
 * Sensitivity Summary
 *
 * Computes concentration metrics for sensitivity analysis.
 * Shows how much of the outcome variation is explained by top drivers.
 */

export interface SensitivitySummary {
  concentration: 'high' | 'medium' | 'diffuse';
  top_n_explain_pct: number;
  top_n: number;
  interpretation: string;
}

export interface TopDriver {
  edge_id: string;
  score: number;
}

/**
 * Compute sensitivity summary from top drivers
 *
 * Concentration thresholds:
 * - high: top 3 explain >= 70% of total score
 * - medium: top 3 explain 40-70%
 * - diffuse: top 3 explain < 40%
 */
export function computeSensitivitySummary(
  topDrivers: TopDriver[]
): SensitivitySummary {
  // Handle empty input gracefully
  if (topDrivers.length === 0) {
    return {
      concentration: 'diffuse',
      top_n_explain_pct: 0,
      top_n: 0,
      interpretation: 'No significant drivers identified.',
    };
  }

  // Calculate total score (denominator is sum of all top_drivers)
  const totalScore = topDrivers.reduce((sum, d) => sum + d.score, 0);

  // Take top 3 (or fewer if less available)
  const top3 = topDrivers.slice(0, 3);
  const top3Score = top3.reduce((sum, d) => sum + d.score, 0);

  // Calculate percentage explained
  const top_n_explain_pct = totalScore > 0 ? top3Score / totalScore : 0;

  // Determine concentration level
  let concentration: 'high' | 'medium' | 'diffuse';
  if (top_n_explain_pct >= 0.70) {
    concentration = 'high';
  } else if (top_n_explain_pct >= 0.40) {
    concentration = 'medium';
  } else {
    concentration = 'diffuse';
  }

  // Generate human-readable interpretation
  const pct = Math.round(top_n_explain_pct * 100);
  let interpretation: string;

  switch (concentration) {
    case 'high':
      interpretation = `Top ${top3.length} edges explain ${pct}% of outcome variation. Focus validation on these relationships.`;
      break;
    case 'medium':
      interpretation = `Top ${top3.length} edges explain ${pct}% of outcome variation. Review several key edges.`;
      break;
    case 'diffuse':
      interpretation = `Effects are spread across many edges (top ${top3.length} explain only ${pct}%). Harder to prioritise validation.`;
      break;
  }

  return {
    concentration,
    top_n_explain_pct: Number(top_n_explain_pct.toFixed(2)),
    top_n: top3.length,
    interpretation,
  };
}
