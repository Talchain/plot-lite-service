/**
 * B1: Story Headlines
 *
 * Generates one-line summaries per option explaining result + confidence.
 */

import type { CoachingInputs, HeadlineType, StoryHeadlines, FragileEdgeContext } from './types.js';
import { getThresholds } from './thresholds.js';

const HEADLINE_TEMPLATES = {
  clear_winner: '{option} outperforms by {deltaPoints} points with high confidence',
  moderate_winner: '{option} leads by {deltaPoints} points, though some uncertainty remains',
  close_call: '{option} edges ahead, but the {deltaPoints}-point margin is within uncertainty',
  high_uncertainty:
    '{option} leads, but {fragileEdgeLabel} could swing the outcome to {altWinner}',
  needs_evidence: 'Decision unclear — gather data on {topGapLabel} before proceeding',
} as const;

export function generateHeadlines(inputs: CoachingInputs): StoryHeadlines {
  const { options, factorSensitivity, fragileEdges, robustness } = inputs;
  const thresholds = getThresholds();

  if (options.length === 0) {
    return {};
  }

  // Sort options by win probability
  const sorted = [...options].sort((a, b) => b.winProbability - a.winProbability);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  if (!winner) {
    return {};
  }

  // Compute metrics for headline selection
  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;
  const hasFactorSensitivity = factorSensitivity.length > 0;

  // Get top fragile edge (highest marginal switch prob)
  const topFragile = fragileEdges
    .filter((e) => e.marginalSwitchProb >= thresholds.headline_fragile_edge_min)
    .sort((a, b) => b.marginalSwitchProb - a.marginalSwitchProb)[0];

  const topFragileMarginal = topFragile?.marginalSwitchProb ?? 0;

  // Compute evidence gap influence (simplified for now)
  const topGapVoI = computeTopGapInfluence(factorSensitivity);

  // Select headline type
  const headlineType = selectHeadlineType(
    winProbDelta,
    stability,
    topGapVoI,
    topFragileMarginal,
    hasFactorSensitivity,
    thresholds
  );

  // Generate headline for winner
  const deltaPoints = Math.round(winProbDelta * 100);

  let winnerHeadline = '';
  switch (headlineType) {
    case 'clear_winner':
      winnerHeadline = HEADLINE_TEMPLATES.clear_winner
        .replace('{option}', winner.label)
        .replace('{deltaPoints}', String(deltaPoints));
      break;
    case 'moderate_winner':
      winnerHeadline = HEADLINE_TEMPLATES.moderate_winner
        .replace('{option}', winner.label)
        .replace('{deltaPoints}', String(deltaPoints));
      break;
    case 'close_call':
      winnerHeadline = HEADLINE_TEMPLATES.close_call
        .replace('{option}', winner.label)
        .replace('{deltaPoints}', String(deltaPoints));
      break;
    case 'high_uncertainty':
      winnerHeadline = HEADLINE_TEMPLATES.high_uncertainty
        .replace('{option}', winner.label)
        .replace('{fragileEdgeLabel}', topFragile?.displayLabel ?? 'key assumptions')
        .replace('{altWinner}', topFragile?.altWinnerLabel ?? 'another option');
      break;
    case 'needs_evidence':
      // Find factor with highest VoI (impact × uncertainty)
      const topGap = factorSensitivity
        .map((f) => ({
          label: f.label,
          voi: Math.abs(f.elasticity ?? f.influence_score ?? 0) * (1 - (f.confidence ?? 0.5)),
        }))
        .sort((a, b) => b.voi - a.voi)[0];
      const topGapLabel = topGap?.label ?? 'key factors';
      winnerHeadline = HEADLINE_TEMPLATES.needs_evidence
        .replace('{topGapLabel}', topGapLabel);
      break;
  }

  const headlines: StoryHeadlines = {
    [winner.id]: winnerHeadline,
  };

  // Simple headlines for other options
  sorted.slice(1).forEach((opt) => {
    headlines[opt.id] = `Runner-up with ${Math.round(opt.winProbability * 100)}% win probability`;
  });

  return headlines;
}

function selectHeadlineType(
  winProbDelta: number,
  stability: number | undefined,
  topGapVoI: number,
  topFragileMarginal: number,
  hasFactorSensitivity: boolean,
  thresholds: ReturnType<typeof getThresholds>
): HeadlineType {
  // 1. Missing data → needs_evidence
  if (!hasFactorSensitivity || stability === undefined) {
    return 'needs_evidence';
  }

  // 2. High swing risk → high_uncertainty (check FIRST)
  if (topGapVoI > thresholds.headline_high_uncertainty_voi || topFragileMarginal > thresholds.headline_high_uncertainty_fragile) {
    return 'high_uncertainty';
  }

  // 3. Clear winner
  if (winProbDelta >= thresholds.headline_clear_winner_delta && stability >= thresholds.headline_clear_winner_stability) {
    return 'clear_winner';
  }

  // 4. Moderate winner
  if (winProbDelta >= thresholds.headline_moderate_winner_delta && stability >= thresholds.headline_moderate_winner_stability) {
    return 'moderate_winner';
  }

  // 5. Close call
  if (winProbDelta < thresholds.headline_close_call_delta) {
    return 'close_call';
  }

  // 6. Remaining: needs_evidence
  return 'needs_evidence';
}

function computeTopGapInfluence(factors: Array<{ confidence?: number; elasticity?: number; influence_score?: number }>): number {
  if (factors.length === 0) return 0;

  const withVoI = factors.map((f) => {
    const impact = Math.abs(f.elasticity ?? f.influence_score ?? 0);
    const confidence = f.confidence ?? 0.5;
    return impact * (1 - confidence);
  });

  return Math.max(...withVoI, 0); // Return max VoI directly
}

export function getFragileEdgeContext(fragileEdges: Array<{ edgeId: string; displayLabel: string; marginalSwitchProb: number; altWinnerLabel: string | null; altWinnerId: string | null }>): FragileEdgeContext | undefined {
  const thresholds = getThresholds();
  const top = fragileEdges
    .filter((e) => e.marginalSwitchProb >= thresholds.headline_fragile_edge_min)
    .sort((a, b) => b.marginalSwitchProb - a.marginalSwitchProb)[0];

  if (!top) return undefined;

  return {
    edgeId: top.edgeId,
    label: top.displayLabel,
    altWinner: top.altWinnerLabel ?? top.altWinnerId ?? 'another option',
    switchProb: top.marginalSwitchProb,
    switchProbDisplay: `${Math.round(top.marginalSwitchProb * 100)}%`,
  };
}

/**
 * Detect headline type for decision (used by orchestrator).
 */
export function detectHeadlineType(inputs: CoachingInputs): HeadlineType {
  const { options, factorSensitivity, fragileEdges, robustness } = inputs;
  const thresholds = getThresholds();

  if (options.length === 0) {
    return 'needs_evidence';
  }

  // Sort options by win probability
  const sorted = [...options].sort((a, b) => b.winProbability - a.winProbability);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  if (!winner) {
    return 'needs_evidence';
  }

  // Compute metrics for headline selection
  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;
  const hasFactorSensitivity = factorSensitivity.length > 0;

  // Get top fragile edge (highest marginal switch prob)
  const topFragile = fragileEdges
    .filter((e) => e.marginalSwitchProb >= thresholds.headline_fragile_edge_min)
    .sort((a, b) => b.marginalSwitchProb - a.marginalSwitchProb)[0];

  const topFragileMarginal = topFragile?.marginalSwitchProb ?? 0;

  // Compute evidence gap influence
  const topGapVoI = computeTopGapInfluence(factorSensitivity);

  return selectHeadlineType(
    winProbDelta,
    stability,
    topGapVoI,
    topFragileMarginal,
    hasFactorSensitivity,
    thresholds
  );
}
