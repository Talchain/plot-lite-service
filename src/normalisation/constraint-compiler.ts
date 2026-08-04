/**
 * Constraint Node Compilation
 *
 * Compiles graph nodes with kind='constraint' into GoalConstraint entries.
 * This allows users to express constraints visually in the graph, which are
 * then extracted and merged with any explicit goal_constraints[].
 *
 * Pipeline order: graph validation → constraint node compilation → constraint validation
 *
 * @see Multi-Constraint Analysis Phase 1 Spec
 */

import type { EngineGraphV3, EngineNodeV3, EngineEdgeV3, GoalConstraint, RawGoalConstraint, RepairRecord } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Node kinds that participate in inference.
 * Constraint targets must be one of these kinds.
 */
const INFERENCE_PARTICIPATING_KINDS = ['goal', 'factor', 'outcome', 'risk', 'action'] as const;


/**
 * Valid constraint operators.
 */
type ConstraintOperator = '>=' | '<=';

/**
 * Result of constraint node compilation.
 */
export interface ConstraintCompilationResult {
  /** Merged goal constraints (compiled + explicit) */
  constraints: GoalConstraint[];
  /** Repair records for auditing */
  repairs: RepairRecord[];
  /** Skipped constraint nodes (for logging) */
  skipped: Array<{
    node_id: string;
    reason: string;
  }>;
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Check if a node kind participates in inference.
 */
function isInferenceParticipating(kind: string): boolean {
  return INFERENCE_PARTICIPATING_KINDS.includes(kind as any);
}

/**
 * Extract operator from constraint node.
 *
 * Looks for explicit operator in:
 * 1. observed_state.metadata.operator
 * 2. data.operator
 *
 * Does NOT infer from strength.mean sign (sign encodes causal direction, not success boundary).
 *
 * @param node Constraint node
 * @returns Operator if found, undefined otherwise
 */
function extractOperator(node: EngineNodeV3 | any): ConstraintOperator | undefined {
  // Check observed_state.metadata.operator
  const metadataOperator = node.observed_state?.metadata?.operator;
  if (metadataOperator === '>=' || metadataOperator === '<=') {
    return metadataOperator;
  }

  // Check data.operator (React Flow nesting)
  const dataOperator = node.data?.operator;
  if (dataOperator === '>=' || dataOperator === '<=') {
    return dataOperator;
  }

  return undefined;
}

/**
 * Find incoming edges to a node from inference-participating nodes.
 *
 * @param nodeId Target node ID
 * @param edges Graph edges
 * @param nodeMap Node lookup map
 * @returns Array of incoming edges from inference-participating nodes
 */
function findIncomingEdgesFromInference(
  nodeId: string,
  edges: EngineEdgeV3[],
  nodeMap: Map<string, EngineNodeV3>
): EngineEdgeV3[] {
  return edges.filter((edge) => {
    if (edge.to !== nodeId) return false;
    const sourceNode = nodeMap.get(edge.from);
    if (!sourceNode) return false;
    return isInferenceParticipating(sourceNode.kind);
  });
}

// -----------------------------------------------------------------------------
// Main Compilation Function
// -----------------------------------------------------------------------------

/**
 * Compile constraint nodes from graph into GoalConstraint entries.
 *
 * For each node with kind='constraint':
 * 1. Find its single incoming edge from an inference-participating node (the target)
 * 2. Extract threshold from observed_state.value
 * 3. Extract operator from observed_state.metadata.operator or data.operator
 * 4. Generate a GoalConstraint entry
 *
 * Merge rules:
 * - Deduplication key = (node_id, operator)
 * - Explicit goal_constraints[] wins over compiled constraints
 * - Same-source duplicates: keep strictest threshold (>= keeps higher, <= keeps lower)
 *
 * @param graph Normalized graph (may contain constraint nodes)
 * @param explicitConstraints Explicit goal_constraints[] from request (may be undefined)
 * @returns Compilation result with merged constraints and repair records
 */
export function compileConstraintNodes(
  graph: EngineGraphV3,
  explicitConstraints: GoalConstraint[] | undefined
): ConstraintCompilationResult {
  const repairs: RepairRecord[] = [];
  const skipped: Array<{ node_id: string; reason: string }> = [];
  const compiledConstraints: GoalConstraint[] = [];

  // Build node lookup map
  const nodeMap = new Map<string, EngineNodeV3>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  // Find all constraint nodes
  const constraintNodes = graph.nodes.filter((node) => node.kind === 'constraint' as any);

  for (const constraintNode of constraintNodes) {
    const nodeId = constraintNode.id;

    // Find incoming edges from inference-participating nodes
    const incomingEdges = findIncomingEdgesFromInference(nodeId, graph.edges, nodeMap);

    // Skip if no incoming edge
    if (incomingEdges.length === 0) {
      skipped.push({
        node_id: nodeId,
        reason: 'No incoming edge from inference-participating node',
      });
      repairs.push({
        field: `constraint_node.${nodeId}`,
        action: 'inferred',
        from_value: null,
        to_value: 'skipped',
        reason: 'Constraint node has no incoming edge from inference-participating node',
      });
      continue;
    }

    // Skip if multiple incoming edges (ambiguous target)
    if (incomingEdges.length > 1) {
      skipped.push({
        node_id: nodeId,
        reason: `Multiple incoming edges (${incomingEdges.length}) - ambiguous target`,
      });
      repairs.push({
        field: `constraint_node.${nodeId}`,
        action: 'inferred',
        from_value: null,
        to_value: 'skipped',
        reason: `Constraint node has ${incomingEdges.length} incoming edges from inference-participating nodes - cannot determine unique target`,
      });
      continue;
    }

    // Extract target node ID from the single incoming edge
    const targetEdge = incomingEdges[0];
    const targetNodeId = targetEdge.from;

    // Extract threshold from observed_state.value
    const threshold = constraintNode.observed_state?.value;
    if (threshold === undefined || typeof threshold !== 'number' || !Number.isFinite(threshold)) {
      skipped.push({
        node_id: nodeId,
        reason: 'Missing or invalid observed_state.value (threshold)',
      });
      repairs.push({
        field: `constraint_node.${nodeId}`,
        action: 'inferred',
        from_value: threshold ?? null,
        to_value: 'skipped',
        reason: 'Constraint node has missing or invalid observed_state.value (threshold)',
      });
      continue;
    }

    // Extract operator (must be explicit, not inferred from strength)
    const operator = extractOperator(constraintNode);
    if (!operator) {
      skipped.push({
        node_id: nodeId,
        reason: 'Missing explicit operator (checked observed_state.metadata.operator and data.operator)',
      });
      repairs.push({
        field: `constraint_node.${nodeId}`,
        action: 'inferred',
        from_value: null,
        to_value: 'skipped',
        reason: 'Constraint node has no explicit operator in observed_state.metadata.operator or data.operator',
      });
      continue;
    }

    // Generate GoalConstraint entry, preserving CEE-specific fields for the
    // temporal constraint filter. Without these the filter cannot detect
    // non-evaluable temporal constraints (B1-8).
    const raw = constraintNode as unknown as Record<string, unknown>;
    const compiledConstraint: RawGoalConstraint = {
      constraint_id: `compiled:${nodeId}`,
      node_id: targetNodeId,
      operator,
      value: threshold,
      label: constraintNode.label,
      ...(raw.deadline_metadata !== undefined && { deadline_metadata: raw.deadline_metadata as Record<string, unknown> }),
      ...(raw.unit !== undefined && { unit: raw.unit as string }),
      ...(raw.source_quote !== undefined && { source_quote: raw.source_quote as string }),
      ...(raw.confidence !== undefined && { confidence: raw.confidence as number }),
      ...(raw.provenance !== undefined && { provenance: raw.provenance as string }),
    };

    compiledConstraints.push(compiledConstraint);

    repairs.push({
      field: `constraint_node.${nodeId}`,
      action: 'derived',
      from_value: `${nodeId}`,
      to_value: `constraint:${targetNodeId}:${operator}:${threshold}`,
      reason: `Compiled constraint node "${nodeId}" targeting "${targetNodeId}" with ${operator} ${threshold}`,
    });
  }

  // Merge explicit and compiled constraints
  const mergedConstraints = mergeConstraints(
    explicitConstraints ?? [],
    compiledConstraints,
    repairs
  );

  return {
    constraints: mergedConstraints,
    repairs,
    skipped,
  };
}

/**
 * Merge explicit and compiled constraints with deduplication.
 *
 * Rules:
 * - Deduplication key = (node_id, operator)
 * - Explicit constraints win over compiled constraints
 * - Same-source duplicates: keep strictest threshold
 *
 * @param explicitConstraints Explicit constraints from request
 * @param compiledConstraints Compiled constraints from graph
 * @param repairs Repair records to append to
 * @returns Merged constraint list
 */
function mergeConstraints(
  explicitConstraints: GoalConstraint[],
  compiledConstraints: GoalConstraint[],
  repairs: RepairRecord[]
): GoalConstraint[] {
  // Track merged constraints by (node_id, operator) key
  const merged = new Map<string, GoalConstraint>();

  // Process explicit constraints first (they have priority)
  for (const constraint of explicitConstraints) {
    const key = `${constraint.node_id}:${constraint.operator}`;
    const existing = merged.get(key);

    if (existing) {
      // Same-source duplicate - keep strictest
      const keepExisting = isStricter(existing, constraint);
      if (!keepExisting) {
        merged.set(key, constraint);
        repairs.push({
          field: `constraint_merge.${constraint.node_id}`,
          action: 'derived',
          from_value: `${existing.constraint_id}`,
          to_value: `${constraint.constraint_id}`,
          reason: `Duplicate explicit constraint for ${constraint.node_id} ${constraint.operator}. Keeping stricter threshold: ${constraint.value} (was ${existing.value})`,
        });
      }
    } else {
      merged.set(key, constraint);
    }
  }

  // Process compiled constraints (explicit wins on conflict)
  for (const constraint of compiledConstraints) {
    const key = `${constraint.node_id}:${constraint.operator}`;
    const existing = merged.get(key);

    if (existing) {
      // Check if existing is explicit (doesn't start with 'compiled:')
      const existingIsExplicit = !existing.constraint_id.startsWith('compiled:');

      if (existingIsExplicit) {
        // Explicit wins - drop compiled
        repairs.push({
          field: `constraint_merge.${constraint.node_id}`,
          action: 'derived',
          from_value: `${constraint.constraint_id}`,
          to_value: `${existing.constraint_id}`,
          reason: `Explicit constraint "${existing.constraint_id}" takes precedence over compiled constraint "${constraint.constraint_id}" for ${constraint.node_id} ${constraint.operator}`,
        });
      } else {
        // Both compiled - keep strictest
        const keepExisting = isStricter(existing, constraint);
        if (!keepExisting) {
          merged.set(key, constraint);
          repairs.push({
            field: `constraint_merge.${constraint.node_id}`,
            action: 'derived',
            from_value: `${existing.constraint_id}`,
            to_value: `${constraint.constraint_id}`,
            reason: `Duplicate compiled constraint for ${constraint.node_id} ${constraint.operator}. Keeping stricter threshold: ${constraint.value} (was ${existing.value})`,
          });
        }
      }
    } else {
      merged.set(key, constraint);
    }
  }

  return Array.from(merged.values());
}

/**
 * Check if constraint A is stricter than constraint B.
 *
 * For >= operator: higher threshold is stricter
 * For <= operator: lower threshold is stricter
 */
function isStricter(a: GoalConstraint, b: GoalConstraint): boolean {
  if (a.operator === '>=') {
    return a.value >= b.value;
  } else {
    return a.value <= b.value;
  }
}
