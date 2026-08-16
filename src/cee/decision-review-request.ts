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
import type { M1Coaching } from '../coaching/types.js';
import {
  interventionTargetIdsFromOptions,
  isOptionControlledLever,
  factorIdOf,
  hasFactorIdConflict,
} from '../lib/intervention-override.js';
import type {
  DecisionReviewRequest,
  DecisionReviewNode,
  DecisionReviewEdge,
  OptionComparisonData,
  FactorSensitivityData,
  FragileEdgeData,
  RobustnessData,
  DeterministicCoachingData,
} from './validation/m1-review-types.js';
import {
  computeFlipThresholdData,
  calculateMargin,
  getWinnerAndRunnerUp,
  type FactorSensitivityInput,
  type OptionComparisonInput,
} from '../coaching/flip-thresholds.js';
import { DEFAULT_EXISTS_PROBABILITY } from '../constants/limits.js';
import { sortByFragility } from '../integrations/isl/adapters/robustness-analysis.js';

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
    zero_reason?: string;
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
 * @returns DecisionReviewRequest ready to send to CEE, or NULL when ISL
 *   returned no analysed options. ROADMAP 2.1248: the builder previously
 *   fabricated `winner: {id:'', label:'', win_probability: 0}` in that case
 *   — a confident empty-identity winner at 0% that CEE serialises verbatim
 *   into the reviewing model's prompt. CEE's `DecisionReviewInputSchema`
 *   requires a non-null winner, so an honest absent winner is NOT
 *   representable on this wire — the honest behaviour is to not build the
 *   request at all; the orchestrator skips with a named reason
 *   (`NO_ANALYSED_OPTIONS`), visible absence instead of confident wrongness.
 */
export function buildDecisionReviewRequest(
  brief: string,
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: ISLResultInput,
  m1Coaching: M1Coaching
): DecisionReviewRequest | null {
  // Compute brief hash
  const briefHash = computeBriefHash(brief);

  // Build stripped graph
  const strippedGraph = buildStrippedGraph(graph);

  // D-U structural lever union (same leaf + same input as the /v2/run egress
  // guard and the coaching layer — ONE union definition, never inlined). An
  // unstamped union lever (the live fac_salary_cost class) must not reach CEE
  // as isl_results.factor_sensitivity, be allowlisted as a "grounded" number,
  // feed the number-corrector, or become a flip candidate.
  const structuralLeverIds = interventionTargetIdsFromOptions(options);

  // Extract ISL results
  const optionComparison = extractOptionComparison(islResult, options);
  const factorSensitivity = extractFactorSensitivity(islResult, structuralLeverIds);
  const fragileEdges = extractFragileEdges(islResult);
  const robustness = extractRobustness(islResult);

  // Build deterministic coaching data
  const deterministicCoaching = buildDeterministicCoaching(m1Coaching);

  // Get winner and runner-up. No winner ⇒ no request: a review of a decision
  // with no analysed options has nothing true to say, and the old
  // `{id:'', label:'', win_probability: 0}` fallback fed the reviewing model
  // a fabricated measurement (ROADMAP 2.1248).
  const { winner, runnerUp } = getWinnerAndRunnerUp(optionComparison);
  if (!winner) return null;

  // Compute flip threshold data. Excluded set is the STRUCTURAL UNION, not
  // just the all-options intersection: a some-but-not-all-options lever must
  // not become a CEE flip candidate either (review fixup, PR #219). The union
  // strictly contains the old getFactorsOverriddenByAllOptions(options)
  // intersection (a factor pinned by EVERY option is pinned by SOME option),
  // so the original probe-budget guard is preserved. Belt-and-braces with the
  // extractFactorSensitivity filter above, which already keeps levers out of
  // this function's input.
  const flipThresholdData = computeFlipThresholdData(
    factorSensitivity as FactorSensitivityInput[],
    optionComparison as OptionComparisonInput[],
    graph,
    structuralLeverIds
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
    // 2.480(a): outcome_mean is emitted ONLY when extractOptionComparison
    // measured one. The key is omitted rather than sent as an explicit
    // undefined, so the in-memory object and the wire agree.
    // 2.1248: winner is non-null by the guard above — the fabricated
    // empty-identity fallback is gone; no winner means no request.
    winner: {
      id: winner.option_id,
      label: winner.option_label ?? winner.option_id,
      win_probability: winner.win_probability,
      ...(winner.expected_outcome !== undefined
        ? { outcome_mean: winner.expected_outcome }
        : {}),
    },
    runner_up: runnerUp
      ? {
          id: runnerUp.option_id,
          label: runnerUp.option_label ?? runnerUp.option_id,
          win_probability: runnerUp.win_probability,
          ...(runnerUp.expected_outcome !== undefined
            ? { outcome_mean: runnerUp.expected_outcome }
            : {}),
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
    exists_probability: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
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

    // ROADMAP 2.480(a) — never coalesce an absent expected outcome to 0.
    //
    // ISL #125 made `outcome.mean` Optional: it is OMITTED when the option's
    // Monte Carlo produced no finite draws, because there is no honest mean for
    // a distribution with no draws. This previously ended `?? 0`, which handed
    // CEE a fabricated zero as a GROUNDED ISL figure — it egresses here as
    // `isl_results.option_comparison[].expected_outcome` and, via
    // getWinnerAndRunnerUp, as `winner`/`runner_up.outcome_mean`, i.e. straight
    // into the reviewing model's context as a measured number.
    //
    // The option itself stays VISIBLE (silent loss would be the other dishonest
    // answer); only the unmeasurable number is absent. This now matches the
    // already-honest sibling builder `buildIslResultsForCorrection`
    // (decision-review-orchestrator.ts), whose consumer number-corrector.ts
    // branches on `expected_outcome !== undefined`, and the same treatment
    // `switch_probability` received on FragileEdgeData. A MEASURED 0 is a real
    // measurement and is preserved.
    const measuredOutcome = opt.expected_outcome ?? opt.outcome?.mean;

    return {
      option_id: optionId,
      option_label: requestOption?.label ?? opt.option_label ?? opt.label ?? optionId,
      win_probability: opt.win_probability ?? 0,
      ...(typeof measuredOutcome === 'number' && Number.isFinite(measuredOutcome)
        ? { expected_outcome: measuredOutcome }
        : {}),
    };
  });
}

/**
 * Extract factor sensitivity data from ISL result.
 *
 * Filters option-controlled levers with the combined D-U predicate: ISL-stamped
 * (zero_reason === 'intervention_override') OR structural-union member (any
 * option intervenes on the factor). The stamp alone under-covers — ISL stamps
 * only elasticity≈0 first-option pins, so an unstamped union lever's
 * elasticity/confidence/label would otherwise egress to CEE on the active
 * DECISION_REVIEW_ENABLE path (review fixup, PR #219).
 *
 * @param structuralLeverIds Canonical union from interventionTargetIdsFromOptions.
 *   Optional for backward compatibility — omitting reverts to stamp-only.
 */
export function extractFactorSensitivity(
  islResult: ISLResultInput,
  structuralLeverIds?: ReadonlySet<string>
): FactorSensitivityData[] {
  const factorSensitivity = islResult.factor_sensitivity ?? [];

  return factorSensitivity
    // F13: drop ambiguous twins (node_id/factor_id present and DIFFERENT) and
    // option-controlled levers, both resolved through the ONE canonical
    // precedence, so an unstamped union lever cannot escape to CEE.
    .filter((f) => !hasFactorIdConflict(f) && !isOptionControlledLever(f, structuralLeverIds))
    .map((f) => {
      const factorId = factorIdOf(f) ?? f.factor_id;
      return {
        factor_id: factorId,
        factor_label: f.factor_label ?? factorId,
        elasticity: f.elasticity ?? 0,
        confidence: f.confidence ?? 0.5,
      };
    });
}

/**
 * Extract fragile edges from ISL result.
 */
function extractFragileEdges(islResult: ISLResultInput): FragileEdgeData[] {
  // FRAGILITY ORDER, not ISL's wire order. ISL emits `fragile_edges` unsorted
  // (live: switch_probability [0.075, ..., 0.61, 0.307], so `[0]` was the LEAST
  // fragile), and CEE reads position [0] — `decompose.ts` fragileEdges[0]
  // becomes stabilityHint.top_fragile_edge. Sorting on a COPY: never mutate
  // ISL's array in place, the caller may still read it. Same comparator as the
  // /v2/run response path, imported rather than re-implemented.
  const fragileEdges = sortByFragility([...(islResult.robustness?.fragile_edges ?? [])]);

  return fragileEdges.map((edge) => {
    // Parse from/to from edge_id if not provided
    const [from, to] = parseEdgeId(edge.edge_id);

    return {
      edge_id: edge.edge_id,
      from: edge.from_id ?? from,
      to: edge.to_id ?? to,
      // NO `?? 0`. A missing switch_probability means ISL did not measure this
      // edge; publishing 0 asserts "this edge will never flip the decision",
      // which is the strongest possible robustness claim and is fabricated.
      // The response path was fixed to omit rather than fabricate, and this
      // path reintroduced it. Absence stays absence — downstream ranking
      // already sinks an absent value (capScenarioContexts uses `?? -1`).
      switch_probability: edge.switch_probability,
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
 *
 * ROADMAP 2.1248: absent inputs propagate as ABSENT keys — never as a
 * plausible middle value. `?? 0` / `?? false` / `?? 'unknown'` manufactured
 * a confident "not robust, 0% stability" claim for runs ISL never assessed,
 * and CEE serialises this object verbatim into the reviewing model's prompt.
 * A MEASURED 0 or false is a real measurement and is preserved. CEE's
 * request schema admits absence (`z.record(z.unknown()).optional()`).
 */
function extractRobustness(islResult: ISLResultInput): RobustnessData {
  const robustness = islResult.robustness;

  return {
    ...(robustness?.recommendation_stability !== undefined
      ? { recommendation_stability: robustness.recommendation_stability }
      : {}),
    ...(robustness?.flip_risk_category !== undefined
      ? { flip_risk_category: robustness.flip_risk_category }
      : {}),
    ...(robustness?.is_robust !== undefined
      ? { is_robust: robustness.is_robust }
      : {}),
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
