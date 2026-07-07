/**
 * M1 Coaching - Main Orchestrator
 *
 * Coordinates all coaching components with graceful degradation.
 * Fully deterministic, no LLM calls, < 100ms computation budget.
 */

import type { M1Coaching, Critique, Readiness } from './types.js';
import type {
  EngineGraphV3,
  FactorSensitivityResultV3,
  GoalConstraint,
  OptionV3,
} from '../types/engine-v3.js';
import { normaliseCoachingInputs } from './normalise-inputs.js';
import { generateHeadlines, getFragileEdgeContext } from './headlines.js';
// A1c: exclude lever-sourced fragile edges from top_fragile_edge.
import { filterLeverSourcedFragileEdges } from '../lib/intervention-override.js';
import { computeEvidenceGaps } from './evidence-gaps.js';
import { generateCritiques } from './critiques.js';
import { generateNextActions, computeReadiness } from './next-actions.js';
import { getThresholds } from './thresholds.js';
import { buildAssumptionsLedger } from './assumptions-ledger.js';
import { computeReadinessSignals } from './readiness-signals.js';
import { computeKeyDrivers } from './key-drivers.js';
import { generateExecutiveSummary } from './executive-summary.js';
import { deriveReadinessTone, type ReadinessToneResult } from './readiness-tone.js';

/**
 * Generate M1 coaching output from ISL response data.
 *
 * @param graph Normalized graph (after filtering)
 * @param options Request options
 * @param islResult ISL response data
 * @param logger Optional logger for warnings
 * @param repairsApplied Optional repairs from normaliser (_meta.repairs_applied)
 * @param ceeCritiques Optional critiques from CEE review
 * @param goalConstraints Optional active goal constraints
 * @param factorSensitivityEnriched Public/enriched `factor_sensitivity[]` array
 *   (graph-merged influence, PLoT-recomputed confidence). When provided,
 *   coaching consumes this as the canonical factor signal instead of raw ISL
 *   `factor_sensitivity`. This keeps `m1_coaching.evidence_gaps` aligned with
 *   the public payload's provenance — same confidence/influence values, same
 *   intervention-override filtering. Falls back to raw ISL when omitted to
 *   preserve backward-compatible behaviour for unit tests that mock ISL
 *   responses directly.
 * @param constraintTargetsUnreliable Producer honesty (lane PLoT-H item A):
 *   true when any goal constraint's target is not decision-grade (default
 *   [0,1] threshold-normalisation range and/or ISL defaulted the target base
 *   to 0.0). The joint-probability readiness gate is SKIPPED in that case —
 *   the joint probabilities it would read are structurally meaningless, and
 *   gating on them would fabricate a "may not achieve the target" coaching
 *   claim from a placeholder 0. The route suppresses the same values on the
 *   public surface (CONSTRAINT_TARGET_UNRELIABLE).
 * @returns M1Coaching object or null if generation fails
 */
export function generateM1Coaching(
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any,
  logger?: any,
  repairsApplied?: Array<{
    field: string;
    action: string;
    from_value: number | string | null;
    to_value: number | string;
    reason: string;
  }>,
  ceeCritiques?: Array<{
    type: string;
    message: string;
    severity?: string;
  }>,
  goalConstraints?: GoalConstraint[],
  factorSensitivityEnriched?: FactorSensitivityResultV3[],
  constraintTargetsUnreliable?: boolean
): M1Coaching | null {
  const startTime = performance.now();

  try {
    // Get thresholds (used by Phase 2-4 components)
    const thresholds = getThresholds();

    // Normalize inputs (required for all components)
    const inputs = normaliseCoachingInputs(graph, options, islResult, factorSensitivityEnriched);

    // Phase 2: Core Coaching (B1-B4)
    const storyHeadlines = safeCompute(() => generateHeadlines(inputs), {}, logger, 'headlines');
    const evidenceGaps = safeCompute(() => computeEvidenceGaps(inputs), [], logger, 'evidence_gaps');
    const modelCritiques = safeCompute(() => generateCritiques(inputs), [], logger, 'critiques');

    // Get headline type from first option (for readiness computation)
    const headlineType = inputs.options.length > 0 ? detectHeadlineType(inputs) : 'needs_evidence';

    // Compute readiness (must be available before tone computation)
    let readiness = computeReadiness(headlineType, modelCritiques, evidenceGaps, thresholds);

    // Post-readiness gate: Joint constraint probability (Task 1)
    // Producer honesty (item A): skipped when constraint targets are
    // unreliable — the joint probabilities are placeholder-derived and the
    // gate would fabricate a GOAL_FEASIBILITY_LOW claim from them.
    if (goalConstraints && goalConstraints.length > 0 && !constraintTargetsUnreliable) {
      const jointProbGate = applyJointProbabilityGate(
        readiness, islResult, thresholds, modelCritiques
      );
      readiness = jointProbGate;
    }

    // Post-readiness gate: Constraint grounding check (Task 3)
    if (goalConstraints && goalConstraints.length > 0) {
      readiness = applyConstraintGroundingCheck(
        readiness, goalConstraints, inputs.graph, modelCritiques
      );
    }

    // Get fragile edge context if relevant.
    // A1c: top_fragile_edge must not surface an edge SOURCED from an option-pinned
    // lever; filter before selection (fallback: undefined when no non-lever edge).
    const a1cLeverIds = inputs.interventionTargetIds ?? new Set<string>();
    const topFragileEdge = getFragileEdgeContext(
      filterLeverSourcedFragileEdges(inputs.fragileEdges, a1cLeverIds, (e) => e.fromId),
    );

    // Phase 3: Differentiators (C1-C3)
    const assumptionsLedger = safeCompute(
      () => buildAssumptionsLedger(inputs, repairsApplied, ceeCritiques),
      { assumptions: [], total_count: 0, high_impact_count: 0, medium_impact_count: 0, low_impact_count: 0 },
      logger,
      'assumptions_ledger'
    );

    const readinessSignals = safeCompute(
      () => computeReadinessSignals(inputs, readiness, modelCritiques, evidenceGaps, thresholds),
      undefined,
      logger,
      'readiness_signals'
    );

    // Phase 4: Summary (D1-D2)
    const keyDrivers = safeCompute(
      () => computeKeyDrivers(inputs),
      [],
      logger,
      'key_drivers'
    );

    // D2-tone: compute the readiness-tone classifier exactly once so the
    // structured emission (`readiness_tone` / `readiness_reasons`) and the
    // tone-gated prose in executive_summary / next_actions all consume the
    // same result.
    //
    // Wrapped in safeCompute for graceful-degradation parity with every other
    // Phase 3-4 field. If the classifier throws here we fall back to
    // `undefined`; both downstream prose generators are themselves wrapped in
    // safeCompute, so their fallback recomputation (when precomputedTone is
    // undefined) is caught at their own boundary — net effect on a tone
    // failure is `readiness_tone`/`readiness_reasons` absent, next_actions →
    // [], executive_summary → undefined, and every other m1_coaching field
    // still emits. Without this wrapper, a tone throw would propagate to the
    // outer try/catch and null the entire m1_coaching block.
    const toneResult = safeCompute<ReadinessToneResult | undefined>(
      () => deriveReadinessTone(inputs, readiness, headlineType, keyDrivers, evidenceGaps, thresholds),
      undefined,
      logger,
      'readiness_tone'
    );

    // Generate next actions (depends on critiques, evidence gaps, and tone)
    const nextActions = safeCompute(
      () => generateNextActions(inputs, headlineType, modelCritiques, evidenceGaps, toneResult),
      [],
      logger,
      'next_actions'
    );

    const executiveSummary = safeCompute(
      () => generateExecutiveSummary(inputs, readiness, headlineType, keyDrivers, evidenceGaps, toneResult),
      undefined,
      logger,
      'executive_summary'
    );

    // Check computation time
    const elapsed = performance.now() - startTime;
    if (elapsed > 100) {
      logger?.warn({ event: 'm1_coaching_slow', elapsed_ms: elapsed });
    }

    return {
      // Phase 2: Core Coaching
      story_headlines: storyHeadlines,
      evidence_gaps: evidenceGaps,
      model_critiques: modelCritiques,
      next_actions: nextActions,
      readiness,
      headline_type: headlineType,
      top_fragile_edge: topFragileEdge
        ? {
            edge_id: topFragileEdge.edgeId,
            label: topFragileEdge.label,
            alternative_winner: topFragileEdge.altWinner,
            switch_probability: topFragileEdge.switchProb,
          }
        : undefined,

      // Phase 3: Differentiators
      assumptions_ledger: assumptionsLedger,
      thresholds_used: thresholds,
      readiness_signals: readinessSignals,

      // Phase 4: Summary
      key_drivers: keyDrivers,
      executive_summary: executiveSummary,

      // D2-tone structured emission (additive; consumers SHOULD prefer
      // these over the legacy `readiness` field for user-facing tiering).
      // Conditionally spread so both keys are genuinely ABSENT on the
      // runtime object when the safeCompute wrapper above caught a
      // classifier error — matching the `readiness_tone?` / `readiness_reasons?`
      // optional-absent contract, not "present with value undefined".
      ...(toneResult
        ? { readiness_tone: toneResult.tone, readiness_reasons: toneResult.reasons }
        : {}),

      // Metadata
      coaching_version: '1.2.0',
      computed_at: new Date().toISOString(),
    };
  } catch (err) {
    logger?.error({ event: 'm1_coaching_error', error: (err as Error).message });
    return null; // Graceful degradation: no coaching
  }
}

/**
 * Safely compute a component, returning fallback on error.
 */
function safeCompute<T>(fn: () => T, fallback: T, logger: any, component: string): T {
  try {
    return fn();
  } catch (err) {
    logger?.warn({
      event: 'm1_coaching_component_error',
      component,
      error: (err as Error).message,
    });
    return fallback;
  }
}

/**
 * Detect headline type from inputs (simplified version of headlines.ts logic).
 */
function detectHeadlineType(inputs: any): any {
  const { options, factorSensitivity, robustness } = inputs;

  if (options.length === 0 || factorSensitivity.length === 0) {
    return 'needs_evidence';
  }

  const sorted = [...options].sort((a: any, b: any) => b.winProbability - a.winProbability);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;

  if (stability === undefined) return 'needs_evidence';
  if (winProbDelta >= 0.20 && stability >= 0.70) return 'clear_winner';
  if (winProbDelta >= 0.10 && stability >= 0.50) return 'moderate_winner';
  if (winProbDelta < 0.10) return 'close_call';

  return 'needs_evidence';
}

// =============================================================================
// Readiness Priority Helper
// =============================================================================

const READINESS_PRIORITY: Record<Readiness, number> = {
  needs_framing: 0,
  needs_evidence: 1,
  close_call: 2,
  ready: 3,
};

/**
 * Cap readiness to a maximum level. Never upgrades readiness (only downgrades).
 */
function capReadiness(current: Readiness, cap: Readiness): Readiness {
  return READINESS_PRIORITY[current] > READINESS_PRIORITY[cap] ? cap : current;
}

// =============================================================================
// Task 1: Joint Probability Gate
// =============================================================================

/**
 * Gate readiness on joint constraint probability from ISL's MCA output.
 *
 * If goal_constraints exist and the max probability_of_joint_goal across all
 * options is below thresholds, cap readiness and emit a critique.
 */
function applyJointProbabilityGate(
  currentReadiness: Readiness,
  islResult: any,
  thresholds: { readiness_joint_prob_floor: number; readiness_joint_prob_close_call: number },
  modelCritiques: Critique[]
): Readiness {
  // Extract per-option joint probabilities from ISL constraint_analysis.
  // Read from options ?? results for V1/legacy ISL payload compatibility.
  const islOptions: any[] = islResult?.options ?? islResult?.results ?? [];
  const jointProbs: number[] = [];
  for (const opt of islOptions) {
    const jp = opt?.constraint_analysis?.joint_probability
      ?? opt?.constraint_analysis?.probability_of_joint_goal;
    if (typeof jp === 'number') {
      jointProbs.push(jp);
    }
  }

  // If MCA data is absent (ISL didn't run MCA), skip gate
  if (jointProbs.length === 0) return currentReadiness;

  const maxJointProb = Math.max(...jointProbs);
  let readiness = currentReadiness;

  // Dedupe: only emit GOAL_FEASIBILITY_LOW if not already present
  const alreadyEmitted = modelCritiques.some((c) => c.type === 'GOAL_FEASIBILITY_LOW');

  if (maxJointProb < thresholds.readiness_joint_prob_floor) {
    // Very low joint probability — cap at needs_evidence
    readiness = capReadiness(readiness, 'needs_evidence');
    if (!alreadyEmitted) {
      modelCritiques.push({
        type: 'GOAL_FEASIBILITY_LOW',
        severity: 'warn',
        challenge_question: 'No option has a strong probability of meeting all stated constraints. The best available option may not achieve the target.',
        suggested_action: 'Review whether your constraints are realistic, or gather more evidence on the factors that most affect feasibility.',
      });
    }
  } else if (maxJointProb < thresholds.readiness_joint_prob_close_call) {
    // Moderate joint probability — cap at close_call
    readiness = capReadiness(readiness, 'close_call');
    if (!alreadyEmitted) {
      modelCritiques.push({
        type: 'GOAL_FEASIBILITY_LOW',
        severity: 'warn',
        challenge_question: 'No option has a strong probability of meeting all stated constraints. The best available option may not achieve the target.',
        suggested_action: 'Review whether your constraints are realistic, or gather more evidence on the factors that most affect feasibility.',
      });
    }
  }

  return readiness;
}

// =============================================================================
// Task 3: Constraint Grounding Check
// =============================================================================

/**
 * Check whether constrained nodes have observed baseline values.
 *
 * When a goal_constraint targets a node without observed_state.value,
 * the constraint analysis is based on defaults rather than evidence.
 */
function applyConstraintGroundingCheck(
  currentReadiness: Readiness,
  goalConstraints: GoalConstraint[],
  graph: EngineGraphV3,
  modelCritiques: Critique[]
): Readiness {
  let readiness = currentReadiness;
  let hasUngrounded = false;

  for (const constraint of goalConstraints) {
    const node = graph.nodes.find((n) => n.id === constraint.node_id);
    // Skip if node not found in graph (schema violation caught elsewhere)
    if (!node) continue;

    const observedValue = node.observed_state?.value;
    if (observedValue === null || observedValue === undefined) {
      hasUngrounded = true;
      const nodeLabel = node.label ?? constraint.label ?? constraint.node_id;
      modelCritiques.push({
        type: 'CONSTRAINT_UNGROUNDED',
        severity: 'warn',
        challenge_question: `Constraint on "${nodeLabel}" lacks a baseline value. The feasibility assessment for this constraint is based on defaults rather than evidence.`,
        suggested_action: `Provide a current observed value for ${nodeLabel} to strengthen the constraint analysis.`,
        targets: [constraint.node_id],
      });
    }
  }

  // Cap readiness once if any constraints are ungrounded
  if (hasUngrounded) {
    readiness = capReadiness(readiness, 'needs_evidence');
  }

  return readiness;
}
