/**
 * Constraint-target ParameterUncertainty injection.
 *
 * Safety-net layer that ensures every constrained (non-goal) node has a
 * ParameterUncertainty entry in the ISL request. Without this, ISL's SCM
 * evaluator defaults non-root nodes to base=0.0, making constraints
 * trivially satisfied.
 *
 * Extracted from the inline Phase 4b+ block in run.ts.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ISLRobustnessRequestV3 } from './translator-v3.js';
import type { GoalConstraint, EngineNodeV3 } from '../../types/engine-v3.js';

/**
 * Std for constraint-target ParameterUncertainty injection.
 * Makes the constraint target effectively observed so ISL evaluates
 * the constraint against the actual threshold, not against base=0.0.
 * This is NOT modelling real uncertainty — it pins the node to its
 * observed value for constraint evaluation.
 *
 * Distinct from translator std floors (≥0.1 for factors, ≥0.01 for
 * external priors) which represent genuine inference uncertainty.
 */
export const CONSTRAINT_PINNED_STD = 0.001;

/**
 * Inject ParameterUncertainty entries for constrained nodes that don't
 * already have one. Mutates `islRequest.parameter_uncertainties` in place.
 *
 * Skip rules:
 * - Nodes that already have a PU entry (inject-only-when-missing)
 * - The goal node (has its own outcome distribution from inference)
 * - Nodes without `observed_state.value` (warn, no injection)
 */
export function injectConstraintParameterUncertainties(
  islRequest: ISLRobustnessRequestV3,
  constraints: GoalConstraint[],
  graphNodes: EngineNodeV3[],
  goalNodeId: string,
  logger?: FastifyBaseLogger,
): { injected: string[]; warnings: string[] } {
  const injected: string[] = [];
  const warnings: string[] = [];

  if (!constraints || constraints.length === 0) {
    return { injected, warnings };
  }

  const existingPuNodeIds = new Set(
    (islRequest.parameter_uncertainties ?? []).map((p) => p.node_id),
  );
  const augmented = [...(islRequest.parameter_uncertainties ?? [])];

  for (const constraint of constraints) {
    // Skip goal node — it has its own outcome distribution from inference
    if (constraint.node_id === goalNodeId) continue;

    // Inject-only-when-missing: skip if PU already exists
    if (existingPuNodeIds.has(constraint.node_id)) continue;

    const node = graphNodes.find((n) => n.id === constraint.node_id);
    if (!node || node.observed_state?.value === undefined) {
      const msg = `Constrained node ${constraint.node_id} has no observed_state.value; ISL may use base=0.0`;
      warnings.push(msg);
      logger?.warn({
        event: 'plot.constraint_no_observed_value',
        node_id: constraint.node_id,
        constraint_id: constraint.constraint_id,
        message: msg,
      });
      continue;
    }

    const mean = node.observed_state.value;
    augmented.push({
      node_id: constraint.node_id,
      distribution: 'normal' as const,
      mean,
      std: CONSTRAINT_PINNED_STD,
    });
    existingPuNodeIds.add(constraint.node_id);
    injected.push(constraint.node_id);

    logger?.info({
      event: 'plot.constraint_auto_uncertainty',
      node_id: constraint.node_id,
      constraint_id: constraint.constraint_id,
      observed_value: mean,
      distribution: 'normal',
      std: CONSTRAINT_PINNED_STD,
    });
  }

  islRequest.parameter_uncertainties = augmented;

  return { injected, warnings };
}
