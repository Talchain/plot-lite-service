/**
 * B3: Model Critiques
 *
 * Surfaces structural issues that may affect decision quality.
 */

import type { CoachingInputs, Critique, CritiqueType } from './types.js';
import { getThresholds } from './thresholds.js';
import { isInterventionOverride, filterInterventionOverrides } from './sensitivity-filter.js';

export function generateCritiques(inputs: CoachingInputs): Critique[] {
  const critiques: Critique[] = [];
  const thresholds = getThresholds();

  // Check DOMINANT_FACTOR
  const dominantFactor = checkDominantFactor(inputs, thresholds);
  if (dominantFactor) critiques.push(dominantFactor);

  // Check MISSING_RISK_PATHWAY
  const missingRisk = checkMissingRiskPathway(inputs);
  if (missingRisk) critiques.push(missingRisk);

  // Check INFLUENTIAL_EXTERNALS
  const influentialExternals = checkInfluentialExternals(inputs, thresholds);
  if (influentialExternals) critiques.push(influentialExternals);

  // Check NARROW_FRAMING
  const narrowFraming = checkNarrowFraming(inputs, thresholds);
  if (narrowFraming) critiques.push(narrowFraming);

  // Check ANCHORING_RISK
  const anchoringRisk = checkAnchoringRisk(inputs, thresholds);
  if (anchoringRisk) critiques.push(anchoringRisk);

  // Check OVERCONFIDENCE
  const overconfidence = checkOverconfidence(inputs, thresholds);
  if (overconfidence) critiques.push(overconfidence);

  return critiques;
}

function checkDominantFactor(inputs: CoachingInputs, thresholds: ReturnType<typeof getThresholds>): Critique | null {
  // A1b: DOMINANT_FACTOR is a tunability critique — it names the dominant factor in
  // a "what would change if {x} had less influence?" challenge. Exclude option-pinned
  // levers via the explicit zero_reason predicate (the durable guarantee — NOT
  // reliant on producer elasticity:0) so a lever is never named as the dominant
  // tunable factor. Single application point: inputs.factorSensitivity is the raw
  // coaching array, not already filtered.
  const factorSensitivity = filterInterventionOverrides(inputs.factorSensitivity);
  if (factorSensitivity.length === 0) return null;

  const absElasticities = factorSensitivity.map((f) => Math.abs(f.elasticity ?? 0));
  const total = absElasticities.reduce((sum, e) => sum + e, 0);
  if (total === 0) return null;

  const dominant = factorSensitivity.find(
    (f, i) => absElasticities[i] / total >= thresholds.critique_dominant_factor_threshold && f.importance_rank <= 3
  );

  if (!dominant) return null;

  return {
    type: 'DOMINANT_FACTOR',
    severity: 'warn',
    challenge_question: `One factor dominates. What would change if ${dominant.label} had less influence?`,
    suggested_action: `Consider whether ${dominant.label}'s importance is evidence-based or assumed`,
    targets: [dominant.node_id],
  };
}

function checkMissingRiskPathway(inputs: CoachingInputs): Critique | null {
  const { factorSensitivity, graph } = inputs;

  // Primary check: factor_sensitivity direction field from ISL
  const MATERIALITY_THRESHOLD = 0.01;
  const negativeFactors = factorSensitivity.filter((f) => f.direction === 'negative');
  // A1b: for intervention-controlled levers the producer zeroes `elasticity`
  // (defence-in-depth), so materiality for a lever must use its PRESERVED
  // structural magnitude `influence_score` — NOT the zeroed elasticity (would
  // drop a material lever from the negative set → false MISSING_RISK_PATHWAY) and
  // NOT unconditional materiality (would wrongly keep a negligible lever). For
  // graph factors influence_score === elasticity === normalised_influence, so the
  // 0.01 threshold is on the same scale and recovers the exact pre-A1b decision.
  const materialNegativeFactors = negativeFactors.filter((f) =>
    isInterventionOverride(f)
      ? Math.abs(f.influence_score ?? 0) > MATERIALITY_THRESHOLD
      : Math.abs(f.elasticity ?? 0) > MATERIALITY_THRESHOLD
  );

  if (materialNegativeFactors.length > 0) return null;

  // Fallback: infer from elasticity sign when direction field is absent
  // ISL sometimes omits direction but negative elasticity = factor hurts goal
  const negativeElasticityFactors = factorSensitivity.filter(
    (f) => f.direction === undefined && (f.elasticity ?? 0) < -0.01
  );
  if (negativeElasticityFactors.length > 0) return null;

  // Structural fallback: check graph for risk nodes with a path to goal.
  // Risk nodes are defined by kind="risk". An edge from a risk node to a goal
  // with effect_direction="negative" or strength_mean < 0 constitutes a valid
  // risk pathway even if ISL doesn't report it in factor_sensitivity.
  if (graph?.nodes && graph?.edges) {
    const goalIds = new Set(
      graph.nodes
        .filter((n: any) => n.kind === 'goal')
        .map((n: any) => n.id)
    );
    const riskIds = new Set(
      graph.nodes
        .filter((n: any) => n.kind === 'risk')
        .map((n: any) => n.id)
    );

    const hasRiskToGoalEdge = graph.edges.some((e: any) => {
      const sourceId = e.from ?? e.source;
      const targetId = e.to ?? e.target;
      if (!riskIds.has(sourceId) || !goalIds.has(targetId)) return false;
      // Edge exists from a risk node to goal — this IS a risk pathway
      const meanValue = e.strength_mean ?? e.strength?.mean ?? e.weight ?? null;
      const direction = e.effect_direction ?? e.direction;
      // Negative mean OR explicit negative direction = risk reduces goal
      return direction === 'negative' || (meanValue !== null && meanValue < 0);
    });

    if (hasRiskToGoalEdge) return null;
  }

  return {
    type: 'MISSING_RISK_PATHWAY',
    severity: 'warn',
    challenge_question: 'No risk factors materially affect your goal. What could go wrong?',
    suggested_action: 'Add factors with negative effects that could reduce your outcome',
  };
}

function checkInfluentialExternals(inputs: CoachingInputs, thresholds: ReturnType<typeof getThresholds>): Critique | null {
  const { factorSensitivity, graph } = inputs;
  if (factorSensitivity.length === 0) return null;

  const topQuartileRank = Math.ceil(factorSensitivity.length * thresholds.critique_influential_external_quartile);
  const influentialExternals = factorSensitivity.filter((f) => {
    const node = graph.nodes.find((n) => n.id === f.node_id);
    return node?.category === 'external' && f.importance_rank <= topQuartileRank;
  });

  if (influentialExternals.length === 0) return null;

  const factorLabels = influentialExternals.map((f) => f.label).join(', ');

  return {
    type: 'INFLUENTIAL_EXTERNALS',
    severity: 'warn',
    challenge_question: `External factors ${factorLabels} significantly affect your outcome but are inherently uncertain. How might you bound these?`,
    suggested_action:
      'Consider converting to observable (if you can estimate baseline) or add proxy factors with explicit 0-1 scales',
    targets: influentialExternals.map((f) => f.node_id),
  };
}

function checkNarrowFraming(inputs: CoachingInputs, thresholds: ReturnType<typeof getThresholds>): Critique | null {
  const { options } = inputs;
  const hasStatusQuo = options.some(
    (o) =>
      o.label?.toLowerCase().includes('status quo') ||
      o.label?.toLowerCase().includes('do nothing') ||
      o.label?.toLowerCase().includes('current')
  );

  if (options.length <= thresholds.critique_narrow_framing_max_options && !hasStatusQuo) {
    return {
      type: 'NARROW_FRAMING',
      severity: 'blocker',
      challenge_question: `Only ${options.length} options without a baseline. Are you missing alternatives?`,
      suggested_action: "Consider adding 'Status Quo' to anchor comparisons",
      context: { count: options.length },
    };
  }

  return null;
}

function checkAnchoringRisk(inputs: CoachingInputs, thresholds: ReturnType<typeof getThresholds>): Critique | null {
  const { factorSensitivity, graph } = inputs;

  const suspects = factorSensitivity.filter((f) => {
    if (f.importance_rank > 3) return false;
    const node = graph.nodes.find((n) => n.id === f.node_id);
    if (!node || node.category === 'external') return false;

    const value = node.observed_state?.value ?? node.observed_state?.baseline;
    return value === thresholds.critique_anchoring_baseline_value;
  });

  if (suspects.length === 0) return null;

  const factorLabels = suspects.map((f) => f.label).join(', ');

  return {
    type: 'ANCHORING_RISK',
    severity: 'warn',
    challenge_question:
      "High-influence factors have 0.5 baseline values — a common 'I don't know' default. Are these estimates or evidence?",
    suggested_action: `Validate assumptions for: ${factorLabels}`,
    targets: suspects.map((f) => f.node_id),
  };
}

function checkOverconfidence(inputs: CoachingInputs, thresholds: ReturnType<typeof getThresholds>): Critique | null {
  const { factorSensitivity } = inputs;

  const withConfidence = factorSensitivity.filter((f) => f.confidence !== undefined);
  if (withConfidence.length === 0) return null;

  const avgConfidence =
    withConfidence.reduce((sum, f) => sum + f.confidence!, 0) / withConfidence.length;

  if (avgConfidence > thresholds.critique_overconfidence_threshold) {
    return {
      type: 'OVERCONFIDENCE',
      severity: 'warn',
      challenge_question: `Average confidence is ${Math.round(avgConfidence * 100)}%. Is this justified?`,
      suggested_action: 'Review whether high-confidence assumptions have supporting evidence',
      context: { average: avgConfidence },
    };
  }

  return null;
}
