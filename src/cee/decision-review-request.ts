/**
 * Decision Review Request Builder
 *
 * Assembles the DecisionReviewRequest from M1 coaching outputs and ISL results.
 * This is the data package sent to CEE /assist/v1/decision-review.
 *
 * @see Brief: M2 Decision Review Integration, Task 3
 */

import { createHash } from 'node:crypto';
import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';
import type { M1Coaching, EvidenceGap, Critique } from '../coaching/types.js';
import type {
  DecisionReviewRequest,
  DecisionReviewNode,
  DecisionReviewEdge,
  OptionComparisonData,
  FactorSensitivityData,
  FragileEdgeData,
  RobustnessData,
  DeterministicCoachingData,
  WinnerData,
  FlipThresholdInputData,
} from './validation/m1-review-types.js';
import {
  computeFlipThresholdData,
  calculateMargin,
  getWinnerAndRunnerUp,
  type FactorSensitivityInput,
  type OptionComparisonInput,
} from '../coaching/flip-thresholds.js';

// =============================================================================
// Types for Input Data
// =============================================================================

/**
 * ISL result shape (subset of fields we need).
 */
export interface ISLResultInput {
  options?: Array<{
    option_id?: string;
    id?: string;
    option_label?: string;
    label?: string;
    win_probability?: number;
    expected_outcome?: number;
    outcome?: { mean?: number };
  }>;
  results?: Array<{
    option_id?: string;
    id?: string;
    option_label?: string;
    label?: string;
    win_probability?: number;
    expected_outcome?: number;
    outcome?: { mean?: number };
  }>;
  factor_sensitivity?: Array<{
    factor_id: string;
    factor_label?: string;
    elasticity?: number;
    confidence?: number;
    direction?: string;
  }>;
  robustness?: {
    recommendation_stability?: number;
    flip_risk_category?: string;
    is_robust?: boolean;
    fragile_edges?: Array<{
      edge_id: string;
      from_id?: string;
      to_id?: string;
      switch_probability?: number;
      marginal_switch_probability?: number;
    }>;
  };
}

// =============================================================================
// Main Builder Function
// =============================================================================

/**
 * Build a DecisionReviewRequest from available data.
 *
 * This assembles all the data needed for CEE's /assist/v1/decision-review endpoint.
 * The same request object should be used to build the ValidationContext for the validator.
 *
 * IMPORTANT: This function implements an ALLOWLIST pattern for CEE payload safety.
 * Each field is explicitly mapped rather than spread from input objects.
 * This prevents unexpected fields from leaking into the CEE request and causing 400s.
 * When adding new fields, explicitly map them rather than using spread operators.
 *
 * @param brief The user's decision brief text
 * @param graph Normalized/filtered graph
 * @param options Request options
 * @param islResult ISL response data
 * @param m1Coaching M1 coaching output
 * @returns DecisionReviewRequest ready to send to CEE
 */
export function buildDecisionReviewRequest(
  brief: string,
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: ISLResultInput,
  m1Coaching: M1Coaching
): DecisionReviewRequest {
  // Compute brief hash
  const briefHash = computeBriefHash(brief);

  // Build stripped graph
  const strippedGraph = buildStrippedGraph(graph);

  // Extract ISL results
  const optionComparison = extractOptionComparison(islResult, options);
  const factorSensitivity = extractFactorSensitivity(islResult);
  const fragileEdges = extractFragileEdges(islResult);
  const robustness = extractRobustness(islResult);

  // Build deterministic coaching data
  const deterministicCoaching = buildDeterministicCoaching(m1Coaching);

  // Get winner and runner-up
  const { winner, runnerUp } = getWinnerAndRunnerUp(optionComparison);

  // Compute flip threshold data
  const flipThresholdData = computeFlipThresholdData(
    factorSensitivity as FactorSensitivityInput[],
    optionComparison as OptionComparisonInput[],
    graph
  );

  // Calculate margin
  const margin = calculateMargin(optionComparison as OptionComparisonInput[]);

  return {
    brief,
    brief_hash: briefHash,
    graph: strippedGraph,
    isl_results: {
      option_comparison: optionComparison,
      factor_sensitivity: factorSensitivity,
      fragile_edges: fragileEdges,
      robustness,
    },
    deterministic_coaching: deterministicCoaching,
    winner: winner
      ? {
          id: winner.option_id,
          label: winner.option_label ?? winner.option_id,
          win_probability: winner.win_probability,
          outcome_mean: winner.expected_outcome,
        }
      : { id: '', label: '', win_probability: 0 },
    runner_up: runnerUp
      ? {
          id: runnerUp.option_id,
          label: runnerUp.option_label ?? runnerUp.option_id,
          win_probability: runnerUp.win_probability,
          outcome_mean: runnerUp.expected_outcome,
        }
      : null,
    flip_threshold_data: flipThresholdData,
    margin,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute brief hash (SHA-256, first 16 chars).
 */
function computeBriefHash(brief: string): string {
  return createHash('sha256').update(brief).digest('hex').slice(0, 16);
}

/**
 * Build stripped graph with only essential fields.
 */
function buildStrippedGraph(graph: EngineGraphV3): {
  nodes: DecisionReviewNode[];
  edges: DecisionReviewEdge[];
} {
  const nodes: DecisionReviewNode[] = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: node.kind ?? 'factor',
  }));

  const edges: DecisionReviewEdge[] = graph.edges.map((edge) => ({
    // Generate edge ID if not present
    id: (edge as any).id ?? `${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    strength: {
      mean: edge.strength?.mean ?? 0.5,
      std: edge.strength?.std ?? 0.2,
    },
    exists_probability: edge.exists_probability ?? 1.0,
  }));

  return { nodes, edges };
}

/**
 * Extract option comparison data from ISL result.
 */
function extractOptionComparison(
  islResult: ISLResultInput,
  options: OptionV3[]
): OptionComparisonData[] {
  // ISL V2 uses 'options', V1 uses 'results'
  const islOptions = islResult.options ?? islResult.results ?? [];

  return islOptions.map((opt) => {
    const optionId = opt.option_id ?? opt.id ?? '';
    const requestOption = options.find((o) => o.id === optionId);

    return {
      option_id: optionId,
      option_label: requestOption?.label ?? opt.option_label ?? opt.label ?? optionId,
      win_probability: opt.win_probability ?? 0,
      expected_outcome: opt.expected_outcome ?? opt.outcome?.mean ?? 0,
    };
  });
}

/**
 * Extract factor sensitivity data from ISL result.
 */
function extractFactorSensitivity(islResult: ISLResultInput): FactorSensitivityData[] {
  const factorSensitivity = islResult.factor_sensitivity ?? [];

  return factorSensitivity.map((f) => ({
    factor_id: f.factor_id,
    factor_label: f.factor_label ?? f.factor_id,
    elasticity: f.elasticity ?? 0,
    confidence: f.confidence ?? 0.5,
  }));
}

/**
 * Extract fragile edges from ISL result.
 */
function extractFragileEdges(islResult: ISLResultInput): FragileEdgeData[] {
  const fragileEdges = islResult.robustness?.fragile_edges ?? [];

  return fragileEdges.map((edge) => {
    // Parse from/to from edge_id if not provided
    const [from, to] = parseEdgeId(edge.edge_id);

    return {
      edge_id: edge.edge_id,
      from: edge.from_id ?? from,
      to: edge.to_id ?? to,
      switch_probability: edge.switch_probability ?? 0,
      marginal_switch_probability: edge.marginal_switch_probability,
    };
  });
}

/**
 * Parse edge ID in "from->to" format.
 */
function parseEdgeId(edgeId: string): [string, string] {
  const match = edgeId.match(/^(.+)->(.+)$/);
  if (match) {
    return [match[1], match[2]];
  }
  // Fallback: split on arrow or return empty strings
  const parts = edgeId.split('->');
  return [parts[0] ?? '', parts[1] ?? ''];
}

/**
 * Extract robustness data from ISL result.
 */
function extractRobustness(islResult: ISLResultInput): RobustnessData {
  const robustness = islResult.robustness;

  return {
    recommendation_stability: robustness?.recommendation_stability ?? 0,
    flip_risk_category: robustness?.flip_risk_category ?? 'unknown',
    is_robust: robustness?.is_robust ?? false,
  };
}

/**
 * Build deterministic coaching data from M1 coaching output.
 */
function buildDeterministicCoaching(m1Coaching: M1Coaching): DeterministicCoachingData {
  return {
    readiness: m1Coaching.readiness,
    headline_type: m1Coaching.headline_type,
    evidence_gaps: m1Coaching.evidence_gaps.map((gap) => ({
      factor_id: gap.factor_id,
      factor_label: gap.factor_label,
      confidence: gap.confidence,
      voi: gap.voi_score,
    })),
    model_critiques: m1Coaching.model_critiques.map((critique) => ({
      type: critique.type,
      severity: critique.severity,
      message: critique.challenge_question,
      ...(critique.suggested_action !== undefined && { suggested_action: critique.suggested_action }),
      ...(critique.targets !== undefined && { affected_node_ids: critique.targets }),
    })),
  };
}
