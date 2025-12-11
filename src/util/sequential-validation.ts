/**
 * Sequential Graph Validation (Phase 4)
 *
 * Validates multi-stage decision graphs for structural consistency:
 * - Stage indices are contiguous (0, 1, 2, ...)
 * - Node stage assignments match stage definitions
 * - Decision/uncertainty nodes exist in graph
 * - No forward references (stage N can only depend on stages < N)
 *
 * ## Endpoint Usage (P1.3 Documentation)
 *
 * The following endpoints validate sequential metadata:
 *
 * | Endpoint                         | Validation Behavior           | Returns on Error |
 * |----------------------------------|-------------------------------|------------------|
 * | POST /v1/analysis/sequential     | Full validation, blocks on error | 400 BAD_INPUT |
 * | POST /v1/analysis/policy-tree    | Full validation, blocks on error | 400 BAD_INPUT |
 * | POST /v1/analysis/conditional-recommend | Optional validation, errors block | 400 BAD_INPUT |
 * | POST /v1/explain/policy          | Optional validation, errors block | 400 BAD_INPUT |
 *
 * ## Validation Issue Codes
 *
 * - `NON_CONTIGUOUS_STAGES` (error): Stage indices must be 0, 1, 2, ...
 * - `MISSING_DECISION_NODE` (error): Stage references non-existent decision node
 * - `MISSING_UNCERTAINTY_NODE` (error): Stage references non-existent uncertainty node
 * - `INVALID_NODE_STAGE` (error): Node has stage not defined in metadata
 * - `INVALID_DISCOUNT_FACTOR` (error): Discount factor not in [0, 1]
 * - `MISSING_SEQUENTIAL_METADATA` (warning): Nodes have stages but no metadata
 * - `INVALID_DECISION_KIND` (warning): Decision node has wrong kind
 * - `FORWARD_REFERENCE` (warning): Edge from later stage to earlier stage
 */

import type { Graph, StageDefinition, GraphNode, GraphEdge } from '../trust/types.js';

export interface SequentialValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  affected_ids?: string[];
}

export interface SequentialValidationResult {
  valid: boolean;
  issues: SequentialValidationIssue[];
  /** Detected stage count (0 if not sequential) */
  stage_count: number;
  /** Node IDs assigned to each stage */
  nodes_by_stage: Map<number, string[]>;
}

/**
 * Validate sequential graph metadata and node assignments
 */
export function validateSequentialGraph(graph: Graph): SequentialValidationResult {
  const issues: SequentialValidationIssue[] = [];
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const edgeMap = buildEdgeMap(graph.edges);
  const nodesByStage = new Map<number, string[]>();

  // If no sequential_metadata, check for node-level stage assignments
  if (!graph.sequential_metadata) {
    // Collect nodes with stage assignments
    for (const node of graph.nodes) {
      if (node.stage !== undefined) {
        const stageNodes = nodesByStage.get(node.stage) ?? [];
        stageNodes.push(node.id);
        nodesByStage.set(node.stage, stageNodes);
      }
    }

    if (nodesByStage.size > 0) {
      // Has node-level stages but no metadata - warn
      issues.push({
        code: 'MISSING_SEQUENTIAL_METADATA',
        message:
          'Nodes have stage assignments but graph lacks sequential_metadata. Consider adding metadata for complete sequential analysis.',
        severity: 'warning',
      });
    }

    return {
      valid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      stage_count: nodesByStage.size,
      nodes_by_stage: nodesByStage,
    };
  }

  const { stages, is_sequential } = graph.sequential_metadata;

  if (!is_sequential) {
    return {
      valid: true,
      issues: [],
      stage_count: 0,
      nodes_by_stage: new Map(),
    };
  }

  // Validate stage indices are contiguous starting from 0
  const stageIndices = stages.map((s) => s.index).sort((a, b) => a - b);
  for (let i = 0; i < stageIndices.length; i++) {
    if (stageIndices[i] !== i) {
      issues.push({
        code: 'NON_CONTIGUOUS_STAGES',
        message: `Stage indices must be contiguous starting from 0. Found index ${stageIndices[i]} at position ${i}.`,
        severity: 'error',
      });
      break;
    }
  }

  // Validate each stage definition
  for (const stage of stages) {
    // Check decisions exist in graph
    for (const decisionId of stage.decisions) {
      const node = nodeMap.get(decisionId);
      if (!node) {
        issues.push({
          code: 'MISSING_DECISION_NODE',
          message: `Stage ${stage.index} ("${stage.label}") references decision node "${decisionId}" which does not exist in graph.`,
          severity: 'error',
          affected_ids: [decisionId],
        });
      } else if (node.kind && node.kind !== 'decision') {
        issues.push({
          code: 'INVALID_DECISION_KIND',
          message: `Stage ${stage.index} decision "${decisionId}" has kind "${node.kind}", expected "decision".`,
          severity: 'warning',
          affected_ids: [decisionId],
        });
      }
    }

    // Check resolved uncertainties exist in graph
    for (const uncId of stage.resolved_uncertainties) {
      const node = nodeMap.get(uncId);
      if (!node) {
        issues.push({
          code: 'MISSING_UNCERTAINTY_NODE',
          message: `Stage ${stage.index} ("${stage.label}") references uncertainty node "${uncId}" which does not exist in graph.`,
          severity: 'error',
          affected_ids: [uncId],
        });
      }
    }

    // Track nodes by stage
    const stageNodeIds = [...stage.decisions, ...stage.resolved_uncertainties];
    nodesByStage.set(stage.index, stageNodeIds);
  }

  // Validate node stage assignments match stage definitions
  for (const node of graph.nodes) {
    if (node.stage !== undefined) {
      const stageDef = stages.find((s) => s.index === node.stage);
      if (!stageDef) {
        issues.push({
          code: 'INVALID_NODE_STAGE',
          message: `Node "${node.id}" has stage ${node.stage} but no stage definition exists for that index.`,
          severity: 'error',
          affected_ids: [node.id],
        });
      }
    }
  }

  // Validate no forward references (edges from later stages to earlier stages)
  const nodeStages = buildNodeStageMap(graph);
  for (const edge of graph.edges) {
    const fromStage = nodeStages.get(edge.from);
    const toStage = nodeStages.get(edge.to);

    if (fromStage !== undefined && toStage !== undefined && fromStage > toStage) {
      issues.push({
        code: 'FORWARD_REFERENCE',
        message: `Edge from "${edge.from}" (stage ${fromStage}) to "${edge.to}" (stage ${toStage}) creates backward dependency.`,
        severity: 'warning',
        affected_ids: [edge.from, edge.to],
      });
    }
  }

  // Validate discount factor if present
  const discountFactor = graph.sequential_metadata.default_discount_factor;
  if (discountFactor !== undefined) {
    if (discountFactor < 0 || discountFactor > 1) {
      issues.push({
        code: 'INVALID_DISCOUNT_FACTOR',
        message: `Discount factor must be between 0 and 1, got ${discountFactor}.`,
        severity: 'error',
      });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    stage_count: stages.length,
    nodes_by_stage: nodesByStage,
  };
}

/**
 * Build a map from node ID to stage number
 * Uses node.stage first, then falls back to stage definitions
 */
function buildNodeStageMap(graph: Graph): Map<string, number> {
  const nodeStages = new Map<string, number>();

  // First, use explicit node.stage assignments
  for (const node of graph.nodes) {
    if (node.stage !== undefined) {
      nodeStages.set(node.id, node.stage);
    }
  }

  // Then, fill in from stage definitions
  if (graph.sequential_metadata?.stages) {
    for (const stage of graph.sequential_metadata.stages) {
      for (const id of [...stage.decisions, ...stage.resolved_uncertainties]) {
        if (!nodeStages.has(id)) {
          nodeStages.set(id, stage.index);
        }
      }
    }
  }

  return nodeStages;
}

/**
 * Build adjacency map for edges
 */
function buildEdgeMap(edges: GraphEdge[]): Map<string, string[]> {
  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = edgeMap.get(edge.from) ?? [];
    targets.push(edge.to);
    edgeMap.set(edge.from, targets);
  }
  return edgeMap;
}

/**
 * Check if a graph is sequential (has multi-stage structure)
 */
export function isSequentialGraph(graph: Graph): boolean {
  if (graph.sequential_metadata?.is_sequential) {
    return true;
  }

  // Check for node-level stage assignments
  return graph.nodes.some((n) => n.stage !== undefined);
}

/**
 * Get maximum stage index in graph (0 if not sequential)
 */
export function getMaxStage(graph: Graph): number {
  let maxStage = 0;

  if (graph.sequential_metadata?.stages) {
    for (const stage of graph.sequential_metadata.stages) {
      maxStage = Math.max(maxStage, stage.index);
    }
  }

  for (const node of graph.nodes) {
    if (node.stage !== undefined) {
      maxStage = Math.max(maxStage, node.stage);
    }
  }

  return maxStage;
}
