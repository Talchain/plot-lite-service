/**
 * B1: Story Headlines
 *
 * Generates one-line summaries per option explaining result + confidence.
 */

import { evidenceAdviceMayName, type CoachingInputs, type HeadlineType, type StoryHeadlines, type FragileEdgeContext, type NormalisedRobustness } from './types.js';
import { NEAR_TIE_THRESHOLD } from '../trust/result-coherence.js';
import { getThresholds } from './thresholds.js';
// A1b: intervention-controlled levers are not tunable evidence/VoI gaps.
import { filterInterventionOverrides } from './sensitivity-filter.js';
// A1c: exclude fragile edges SOURCED from an option-pinned lever from the high_uncertainty headline.
import { isLeverSourcedEdge } from '../lib/intervention-override.js';

const HEADLINE_TEMPLATES = {
  // DL 5 Oct (guiding principle "appropriately uncertain"): model-relative, no race framing, and the "held" claim only
  // where the ROBUSTNESS LEVEL is high (selectHeadlineType). `recommendationStability` is the leader's share relabelled
  // (types.ts), so it can never stand in for "held under the changes we tested".
  // Science 5 Oct: "came out best" reads the same under a minimised goal ("scored highest" reads as the most churn), and
  // {deltaPoints} is the win-share gap, so it is said in percentage points of simulated futures, never bare "points".
  clear_winner: 'On this model, {option} came out best {deltaPoints} percentage points more often than the next option, and that held under the changes we tested',
  moderate_winner: '{option} leads by {deltaPoints} points, though some uncertainty remains',
  close_call: '{option} edges ahead, but the {deltaPoints}-point margin is within uncertainty',
  high_uncertainty:
    '{option} leads, but {fragileEdgeLabel} could swing the outcome to {altWinner}',
  needs_evidence: 'Decision unclear — gather data on {topGapLabel} before proceeding',
} as const;

/**
 * Presence guard (Codex P1-5): only an edge with a MEASURED switchProb may
 * qualify as a headline/context fragile edge. Absent means NOT COMPUTED (never
 * a coalesced 0), so unmeasured edges never pass a threshold filter and never
 * reach a rendered percentage.
 */
function hasMeasuredSwitchProb<T extends { switchProb?: number }>(
  e: T
): e is T & { switchProb: number } {
  return typeof e.switchProb === 'number';
}

/**
 * Sort options by win probability descending, treating a non-finite probability
 * (NaN / ±Infinity from a degenerate ISL Monte Carlo run) as the LOWEST rank.
 * Using subtraction directly would return NaN for non-finite inputs, leaving the
 * sort order undefined — so an invalid option could be crowned "winner" merely
 * because the comparator is ambiguous. Ranking non-finite last guarantees a finite
 * option wins whenever one exists, and never produces a NaN comparison result.
 */
function compareByWinProbabilityDesc(
  a: { winProbability: number },
  b: { winProbability: number }
): number {
  const ka = Number.isFinite(a.winProbability) ? a.winProbability : -Infinity;
  const kb = Number.isFinite(b.winProbability) ? b.winProbability : -Infinity;
  if (ka === kb) return 0;
  return kb > ka ? 1 : -1;
}

export function generateHeadlines(inputs: CoachingInputs): StoryHeadlines {
  const { options, factorSensitivity, fragileEdges, robustness } = inputs;
  const thresholds = getThresholds();

  if (options.length === 0) {
    return {};
  }

  // Sort options by win probability (finite-safe: invalid options rank last)
  const sorted = [...options].sort(compareByWinProbabilityDesc);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  if (!winner) {
    return {};
  }

  // Honesty (Codex round-3): if ANY option's win probability is non-finite, the
  // relative ranking of EVERY option is unknowable — the invalid option could rank
  // first, second, or last — so NO "winner"/"leads"/"Runner-up" claim is justified
  // for any option. Emit the same rank-neutral, number-free message for every option
  // rather than using sort order as evidence of rank. (Round-2 only suppressed the
  // claim for the winner/immediate runner-up, which still mis-ranked [0.7, 0.3, NaN].)
  if (options.some((o) => !Number.isFinite(o.winProbability))) {
    const neutral: StoryHeadlines = {};
    for (const o of options) {
      neutral[o.id] = 'Win probability could not be computed — ranking unavailable';
    }
    return neutral;
  }

  // Compute metrics for headline selection (all options are finite past this point)
  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;
  const hasFactorSensitivity = factorSensitivity.length > 0;

  // A1b: VoI/evidence derivation must not name option-pinned levers as tunable
  // gaps. Exclude levers for the VoI sites ONLY — the hasFactorSensitivity
  // existence check above keeps the original array (we do not erase lever
  // existence from headline reasoning). Used at both VoI sites below.
  const tunable = filterInterventionOverrides(factorSensitivity);

  // Get top fragile edge (highest switch probability).
  // A1c: exclude fragile edges SOURCED from an option-pinned lever — naming
  // "lever → X ... could swing the outcome" in the high_uncertainty headline
  // implies the user can tune a pinned lever. Non-lever fragile edges are kept;
  // if none qualify, topFragile is undefined → the headline type shifts off
  // high_uncertainty (no lever named, no fragile edge forced).
  const leverIds = inputs.interventionTargetIds ?? new Set<string>();
  const topFragile = fragileEdges
    .filter(hasMeasuredSwitchProb)
    .filter((e) => e.switchProb >= thresholds.headline_fragile_edge_min && !isLeverSourcedEdge(e.fromId, leverIds))
    .sort((a, b) => b.switchProb - a.switchProb)[0];

  const topFragileSwitchProb = topFragile?.switchProb ?? 0;

  // Compute evidence gap influence (simplified for now)
  const topGapVoI = computeTopGapInfluence(tunable);

  // Select headline type
  const headlineType = selectHeadlineType(
    winProbDelta,
    winner.winProbability,
    stability,
    topGapVoI,
    topFragileSwitchProb,
    hasFactorSensitivity,
    thresholds,
    robustness.level,
  );

  // Generate headline for winner. winProbDelta is finite here (the rank-neutral
  // early return above handled any non-finite option), so every headline number
  // is finite — no "... by Infinity points" can be produced.
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
    case 'needs_evidence': {
      // Find factor with highest VoI (impact × uncertainty)
      // AIQ 5866850180: "gather data on X" names X only when X's EVPPI was MEASURED above resolution.
      const topGap = tunable
        .filter((f) => evidenceAdviceMayName(inputs, f.node_id))
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
  }

  const headlines: StoryHeadlines = {
    [winner.id]: winnerHeadline,
  };

  // Simple headlines for the other options. Every winProbability is finite here
  // (any non-finite option triggered the rank-neutral early return above), so the
  // "Runner-up" rank label is justified and the percentage is always finite.
  sorted.slice(1).forEach((opt) => {
    headlines[opt.id] = `Runner-up with ${Math.round(opt.winProbability * 100)}% win probability`;
  });

  return headlines;
}

/**
 * ⛔ "HIGHLY UNCERTAIN" ONLY WHEN THE RESULT IS (AI Quality ruling olumi-programme-docs #72 5866850180; MG as
 * PLoT owner). Served journey A: "£59 currently leads, but the outcome is highly uncertain" on 4/6 Runs with
 * the leader at 0.849 and decision EVPI 5.2e-6 — the swing-risk heuristics below (impact × (1 − confidence),
 * a fragile edge's switch probability) fired on a settled result. They may still pick `high_uncertainty`,
 * but only when the leader's win share is below HIGH_UNCERTAINTY_MAX_LEADER_SHARE or the top two are a near
 * tie (`NEAR_TIE_THRESHOLD`, the same gap `near_tie` publishes); otherwise the Run is read by the rules
 * that follow.
 */
export const HIGH_UNCERTAINTY_MAX_LEADER_SHARE = 0.6;

function selectHeadlineType(
  winProbDelta: number,
  leaderShare: number,
  stability: number | undefined,
  topGapVoI: number,
  topFragileSwitchProb: number,
  hasFactorSensitivity: boolean,
  thresholds: ReturnType<typeof getThresholds>,
  /** ISL's robustness level: `clear_winner` says the lead held, so it needs a HIGH level, never the share alone. */
  robustnessLevel: NormalisedRobustness['level'],
): HeadlineType {
  // 1. Missing data → needs_evidence
  if (!hasFactorSensitivity || stability === undefined) {
    return 'needs_evidence';
  }

  // 2. High swing risk → high_uncertainty (check FIRST) — only on a result that IS uncertain (AIQ 5866850180).
  const resultUncertain = leaderShare < HIGH_UNCERTAINTY_MAX_LEADER_SHARE || winProbDelta < NEAR_TIE_THRESHOLD;
  if (resultUncertain && (topGapVoI > thresholds.headline_high_uncertainty_voi || topFragileSwitchProb > thresholds.headline_high_uncertainty_fragile)) {
    return 'high_uncertainty';
  }

  // 3. Clear winner
  if (winProbDelta >= thresholds.headline_clear_winner_delta && stability >= thresholds.headline_clear_winner_stability
    && robustnessLevel === 'high') {
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

export function getFragileEdgeContext(fragileEdges: Array<{ edgeId: string; displayLabel: string; switchProb?: number; altWinnerLabel: string | null; altWinnerId: string | null }>): FragileEdgeContext | undefined {
  const thresholds = getThresholds();
  const top = fragileEdges
    .filter(hasMeasuredSwitchProb)
    .filter((e) => e.switchProb >= thresholds.headline_fragile_edge_min)
    .sort((a, b) => b.switchProb - a.switchProb)[0];

  if (!top) return undefined;

  return {
    edgeId: top.edgeId,
    label: top.displayLabel,
    altWinner: top.altWinnerLabel ?? top.altWinnerId ?? 'another option',
    switchProb: top.switchProb,
    switchProbDisplay: `${Math.round(top.switchProb * 100)}%`,
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

  // Sort options by win probability (finite-safe: invalid options rank last)
  const sorted = [...options].sort(compareByWinProbabilityDesc);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  if (!winner) {
    return 'needs_evidence';
  }

  // Compute metrics for headline selection
  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;
  const hasFactorSensitivity = factorSensitivity.length > 0;

  // A1b: VoI classification must not be driven by option-pinned levers. Exclude
  // levers for the VoI site ONLY — the hasFactorSensitivity existence check above
  // keeps the original array. Mirrors generateHeadlines so both classify
  // consistently, and does not rely on the producer elasticity:0 alone (the
  // explicit predicate is the durable guarantee).
  const tunable = filterInterventionOverrides(factorSensitivity);

  // Get top fragile edge (highest switch probability).
  // A1c: exclude lever-sourced fragile edges from the high_uncertainty CLASSIFIER
  // too, so the headline TYPE stays consistent with the (filtered) headline text.
  const leverIds = inputs.interventionTargetIds ?? new Set<string>();
  const topFragile = fragileEdges
    .filter(hasMeasuredSwitchProb)
    .filter((e) => e.switchProb >= thresholds.headline_fragile_edge_min && !isLeverSourcedEdge(e.fromId, leverIds))
    .sort((a, b) => b.switchProb - a.switchProb)[0];

  const topFragileSwitchProb = topFragile?.switchProb ?? 0;

  // Compute evidence gap influence
  const topGapVoI = computeTopGapInfluence(tunable);

  return selectHeadlineType(
    winProbDelta,
    winner.winProbability,
    stability,
    topGapVoI,
    topFragileSwitchProb,
    hasFactorSensitivity,
    thresholds,
    robustness.level,
  );
}
