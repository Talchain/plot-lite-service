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
 * Distinct from the translator's user-uncertainty and default paths:
 *   - User-supplied `observed_state.std` is clamped to [MIN_USER_STD, MAX_USER_STD]
 *     (see `parameter-uncertainty-bounds.ts`).
 *   - Synthesised defaults (binary / value-based / fallback) are floored at
 *     DEFAULT_STD_FLOOR.
 *   - External priors are floored at 0.01.
 * This constant only applies to constrained nodes that arrive at the injection
 * step without an existing PU entry.
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
 * Per-constraint classification — the SINGLE source of truth for "does this
 * constraint get a PU injected, and if not why". Both the injector (below) and
 * the admission-cost planner's PU count (via {@link selectConstraintInjectedPuNodeIds})
 * derive their decision from this one function, so PLoT's EVPI `u` can never
 * drift from what ISL actually receives + counts.
 */
export type ConstraintPuClassification =
  | { kind: 'inject'; mean: number }
  | { kind: 'skip'; reason: SkippedPU['reason'] }
  | { kind: 'existing' };

/** Classify a single constraint against the PUs already present. Pure. */
export function classifyConstraintPu(
  constraint: GoalConstraint,
  nodeMap: ReadonlyMap<string, EngineNodeV3>,
  goalNodeId: string,
  existingPuNodeIds: ReadonlySet<string>,
): ConstraintPuClassification {
  // Goal node gets its distribution from ISL's outcome computation.
  if (constraint.node_id === goalNodeId) return { kind: 'skip', reason: 'goal_node' };
  // Inject-only-when-missing: never override an existing PU from the translator.
  if (existingPuNodeIds.has(constraint.node_id)) return { kind: 'existing' };
  const node = nodeMap.get(constraint.node_id);
  if (!node) return { kind: 'skip', reason: 'missing_node' };
  if (node.observed_state?.value === undefined) return { kind: 'skip', reason: 'missing_observed_state' };
  return { kind: 'inject', mean: node.observed_state.value };
}

/**
 * The set of node_ids that {@link injectConstraintParameterUncertainties} WOULD
 * inject, given the PUs already present (`existingPuNodeIds` — the factor PUs).
 * Pure + deterministic, and knowable at PLANNING time (before the injection
 * runs). Used by the admission-cost planner so PLoT prices EVPI over
 * `factor PUs ∪ constraint-injected PUs` — exactly ISL's `u`. Excludes node_ids
 * already in `existingPuNodeIds`, so the caller takes the UNION as
 * `existingPuNodeIds.size + result.size`.
 */
export function selectConstraintInjectedPuNodeIds(
  constraints: GoalConstraint[] | undefined,
  graphNodes: EngineNodeV3[],
  goalNodeId: string,
  existingPuNodeIds: ReadonlySet<string>,
  // Optional prebuilt id→node map (built once by the caller and shared with the
  // injector) so the plan-time selection and the build-time injection don't each
  // reconstruct an identical map over the same nodes. Omitted callers build one.
  sharedNodeMap?: ReadonlyMap<string, EngineNodeV3>,
): Set<string> {
  const injected = new Set<string>();
  if (!constraints || constraints.length === 0) return injected;
  const nodeMap = sharedNodeMap ?? new Map(graphNodes.map((n) => [n.id, n]));
  // Mirror the injector: a node accepted earlier becomes "existing" for later
  // duplicate constraints on the same node (so it is counted exactly once).
  const running = new Set(existingPuNodeIds);
  for (const constraint of constraints) {
    if (classifyConstraintPu(constraint, nodeMap, goalNodeId, running).kind === 'inject') {
      injected.add(constraint.node_id);
      running.add(constraint.node_id);
    }
  }
  return injected;
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
  // Optional prebuilt id→node map shared with the plan-time
  // {@link selectConstraintInjectedPuNodeIds} so the map is built once, not twice.
  // Omitted callers build one.
  sharedNodeMap?: ReadonlyMap<string, EngineNodeV3>,
): { injected: InjectedPU[]; skipped: SkippedPU[] } {
  const injected: InjectedPU[] = [];
  const skipped: SkippedPU[] = [];

  if (!constraints || constraints.length === 0) {
    return { injected, skipped };
  }

  const existingPuNodeIds = new Set(
    (islRequest.parameter_uncertainties ?? []).map((p) => p.node_id),
  );
  const nodeMap = sharedNodeMap ?? new Map(graphNodes.map((n) => [n.id, n]));
  const augmented = [...(islRequest.parameter_uncertainties ?? [])];

  for (const constraint of constraints) {
    // Single source of truth for the accept/skip decision (shared with the
    // planner's PU count via selectConstraintInjectedPuNodeIds).
    const cls = classifyConstraintPu(constraint, nodeMap, goalNodeId, existingPuNodeIds);

    if (cls.kind === 'existing') continue;

    if (cls.kind === 'skip') {
      skipped.push({ node_id: constraint.node_id, reason: cls.reason });
      if (cls.reason === 'missing_node') {
        logger?.warn({
          event: 'plot.constraint_missing_node',
          node_id: constraint.node_id,
          constraint_id: constraint.constraint_id,
          message: `Constrained node ${constraint.node_id} not found in graph`,
        });
      } else if (cls.reason === 'missing_observed_state') {
        logger?.warn({
          event: 'plot.constraint_no_observed_value',
          node_id: constraint.node_id,
          constraint_id: constraint.constraint_id,
          message: `Constrained node ${constraint.node_id} has no observed_state.value; ISL may use base=0.0`,
        });
      }
      continue;
    }

    const mean = cls.mean;
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
