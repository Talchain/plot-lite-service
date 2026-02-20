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
 * Pins constrained node to its observed value for constraint evaluation.
 * Not modelling real uncertainty — prevents ISL base=0.0 default.
 *
 * Distinct from translator std floors (≥0.1 for factors, ≥0.01 for
 * external priors) which represent genuine inference uncertainty.
 */
export const CONSTRAINT_PINNED_STD = 0.001;

/** A PU entry that was injected for a constrained node. */
export interface InjectedPU {
  node_id: string;
  mean: number;
  std: number;
}

/** A constrained node that was skipped (not injected). */
export interface SkippedPU {
  node_id: string;
  reason: 'goal_node' | 'missing_node' | 'missing_observed_state';
}

/**
 * Inject ParameterUncertainty entries for constrained nodes that don't
 * already have one. Mutates `islRequest.parameter_uncertainties` in place.
 *
 * Skip rules (each produces a SkippedPU entry):
 * - The goal node (has its own outcome distribution from inference)
 * - Nodes not present in the graph
 * - Nodes without `observed_state.value`
 * - Nodes that already have a PU entry (inject-only-when-missing) — silently skipped, not in `skipped`
 *
 * @param islRequest - ISL request to mutate (parameter_uncertainties array)
 * @param constraints - Active goal constraints
 * @param graphNodes - Filtered graph nodes
 * @param goalNodeId - Goal node ID (skipped for injection)
 * @param logger - Optional Fastify logger
 * @returns Injected PU entries and skipped nodes with reasons
 */
export function injectConstraintParameterUncertainties(
  islRequest: ISLRobustnessRequestV3,
  constraints: GoalConstraint[],
  graphNodes: EngineNodeV3[],
  goalNodeId: string,
  logger?: FastifyBaseLogger,
): { injected: InjectedPU[]; skipped: SkippedPU[] } {
  const injected: InjectedPU[] = [];
  const skipped: SkippedPU[] = [];

  if (!constraints || constraints.length === 0) {
    return { injected, skipped };
  }

  const existingPuNodeIds = new Set(
    (islRequest.parameter_uncertainties ?? []).map((p) => p.node_id),
  );
  const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));
  const augmented = [...(islRequest.parameter_uncertainties ?? [])];

  for (const constraint of constraints) {
    // Skip goal node — goal nodes get their distribution from ISL's outcome computation
    if (constraint.node_id === goalNodeId) {
      skipped.push({ node_id: constraint.node_id, reason: 'goal_node' });
      continue;
    }

    // Inject-only-when-missing: never override existing PU from the translator
    if (existingPuNodeIds.has(constraint.node_id)) continue;

    const node = nodeMap.get(constraint.node_id);

    // Skip nodes not in the graph
    if (!node) {
      skipped.push({ node_id: constraint.node_id, reason: 'missing_node' });
      logger?.warn({
        event: 'plot.constraint_missing_node',
        node_id: constraint.node_id,
        constraint_id: constraint.constraint_id,
        message: `Constrained node ${constraint.node_id} not found in graph`,
      });
      continue;
    }

    // Skip nodes without observed_state.value (cannot fabricate a mean)
    if (node.observed_state?.value === undefined) {
      skipped.push({ node_id: constraint.node_id, reason: 'missing_observed_state' });
      logger?.warn({
        event: 'plot.constraint_no_observed_value',
        node_id: constraint.node_id,
        constraint_id: constraint.constraint_id,
        message: `Constrained node ${constraint.node_id} has no observed_state.value; ISL may use base=0.0`,
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
    injected.push({ node_id: constraint.node_id, mean, std: CONSTRAINT_PINNED_STD });

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

  return { injected, skipped };
}
