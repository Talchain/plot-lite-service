/**
 * B3: Model Critiques
 *
 * Surfaces structural issues that may affect decision quality.
 */

import type { CoachingInputs, Critique, CritiqueType } from './types.js';

export function generateCritiques(inputs: CoachingInputs): Critique[] {
  const critiques: Critique[] = [];

  // Check DOMINANT_FACTOR
  const dominantFactor = checkDominantFactor(inputs);
  if (dominantFactor) critiques.push(dominantFactor);

  // Check MISSING_RISK_PATHWAY
  const missingRisk = checkMissingRiskPathway(inputs);
  if (missingRisk) critiques.push(missingRisk);

  // Check INFLUENTIAL_EXTERNALS
  const influentialExternals = checkInfluentialExternals(inputs);
  if (influentialExternals) critiques.push(influentialExternals);

  // Check NARROW_FRAMING
  const narrowFraming = checkNarrowFraming(inputs);
  if (narrowFraming) critiques.push(narrowFraming);

  // Check ANCHORING_RISK
  const anchoringRisk = checkAnchoringRisk(inputs);
  if (anchoringRisk) critiques.push(anchoringRisk);

  // Check OVERCONFIDENCE
  const overconfidence = checkOverconfidence(inputs);
  if (overconfidence) critiques.push(overconfidence);

  return critiques;
}

function checkDominantFactor(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity } = inputs;
  if (factorSensitivity.length === 0) return null;

  const absElasticities = factorSensitivity.map((f) => Math.abs(f.elasticity ?? 0));
  const total = absElasticities.reduce((sum, e) => sum + e, 0);
  if (total === 0) return null;

  const dominant = factorSensitivity.find(
    (f, i) => absElasticities[i] / total >= 0.50 && f.importance_rank <= 3
  );

  if (!dominant) return null;

  return {
    type: 'DOMINANT_FACTOR',
    severity: 'warning',
    challenge_question: `One factor dominates. What would change if ${dominant.label} had less influence?`,
    suggested_action: `Consider whether ${dominant.label}'s importance is evidence-based or assumed`,
    targets: [dominant.node_id],
  };
}

function checkMissingRiskPathway(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity } = inputs;

  const negativeFactors = factorSensitivity.filter((f) => f.direction === 'negative');
  const materialNegativeFactors = negativeFactors.filter(
    (f) => Math.abs(f.elasticity ?? 0) > 0.01
  );

  if (negativeFactors.length === 0 || materialNegativeFactors.length === 0) {
    return {
      type: 'MISSING_RISK_PATHWAY',
      severity: 'concern',
      challenge_question: 'No risk factors materially affect your goal. What could go wrong?',
      suggested_action: 'Add factors with negative effects that could reduce your outcome',
    };
  }

  return null;
}

function checkInfluentialExternals(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity, graph } = inputs;
  if (factorSensitivity.length === 0) return null;

  const topQuartileRank = Math.ceil(factorSensitivity.length / 4);
  const influentialExternals = factorSensitivity.filter((f) => {
    const node = graph.nodes.find((n) => n.id === f.node_id);
    return node?.category === 'external' && f.importance_rank <= topQuartileRank;
  });

  if (influentialExternals.length === 0) return null;

  const factorLabels = influentialExternals.map((f) => f.label).join(', ');

  return {
    type: 'INFLUENTIAL_EXTERNALS',
    severity: 'warning',
    challenge_question: `External factors ${factorLabels} significantly affect your outcome but are inherently uncertain. How might you bound these?`,
    suggested_action:
      'Consider converting to observable (if you can estimate baseline) or add proxy factors with explicit 0-1 scales',
    targets: influentialExternals.map((f) => f.node_id),
  };
}

function checkNarrowFraming(inputs: CoachingInputs): Critique | null {
  const { options } = inputs;
  const hasStatusQuo = options.some(
    (o) =>
      o.label?.toLowerCase().includes('status quo') ||
      o.label?.toLowerCase().includes('do nothing') ||
      o.label?.toLowerCase().includes('current')
  );

  if (options.length <= 2 && !hasStatusQuo) {
    return {
      type: 'NARROW_FRAMING',
      severity: 'concern',
      challenge_question: `Only ${options.length} options without a baseline. Are you missing alternatives?`,
      suggested_action: "Consider adding 'Status Quo' to anchor comparisons",
      context: { count: options.length },
    };
  }

  return null;
}

function checkAnchoringRisk(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity, graph } = inputs;

  const suspects = factorSensitivity.filter((f) => {
    if (f.importance_rank > 3) return false;
    const node = graph.nodes.find((n) => n.id === f.node_id);
    if (!node || node.category === 'external') return false;

    const value = node.observed_state?.value ?? node.observed_state?.baseline;
    return value === 0.5;
  });

  if (suspects.length === 0) return null;

  const factorLabels = suspects.map((f) => f.label).join(', ');

  return {
    type: 'ANCHORING_RISK',
    severity: 'warning',
    challenge_question:
      "High-influence factors have 0.5 baseline values — a common 'I don't know' default. Are these estimates or evidence?",
    suggested_action: `Validate assumptions for: ${factorLabels}`,
    targets: suspects.map((f) => f.node_id),
  };
}

function checkOverconfidence(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity } = inputs;

  const withConfidence = factorSensitivity.filter((f) => f.confidence !== undefined);
  if (withConfidence.length === 0) return null;

  const avgConfidence =
    withConfidence.reduce((sum, f) => sum + f.confidence!, 0) / withConfidence.length;

  if (avgConfidence > 0.85) {
    return {
      type: 'OVERCONFIDENCE',
      severity: 'warning',
      challenge_question: `Average confidence is ${Math.round(avgConfidence * 100)}%. Is this justified?`,
      suggested_action: 'Review whether high-confidence assumptions have supporting evidence',
      context: { average: avgConfidence },
    };
  }

  return null;
}
