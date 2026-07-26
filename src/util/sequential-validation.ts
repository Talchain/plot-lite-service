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
 * | POST /v1/analysis/conditional-recommend | Optional validation, errors block | 400 BAD_INPUT |
 * | POST /v1/explain/policy          | Optional validation, errors block | 400 BAD_INPUT |
 *
 * POST /v1/analysis/sequential and POST /v1/analysis/policy-tree were also
 * listed here until 26 Jul 2026, when both routes were deleted as vacuous.
 * This module outlived them: the two endpoints above are real consumers.
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
 * - `INVALID_SEQUENTIAL_METADATA` (error): `stages` is not an array
 * - `INVALID_STAGE_DEFINITION` (error): A `stages[]` entry is not a stage object
 * - `MISSING_STAGE_ID_LIST` (warning): Stage omits `decisions`/`resolved_uncertainties`
 * - `INVALID_STAGE_ID_LIST` (warning): Stage id list present but not an array
 *
 * ## This function must be TOTAL
 *
 * The analysis routes cast the request body (`req.body as ...`) with no runtime
 * schema validation of `sequential_metadata`, so everything below is UNTRUSTED
 * JSON whatever the TypeScript types promise. This function previously iterated
 * `stage.decisions` directly; a caller that omitted the field (sending, say,
 * `decision_node_id` instead) hit `for...of undefined`, and the resulting
 * TypeError surfaced to users as an opaque 500 "Something went wrong". That
 * was found on two routes since deleted, but the same untrusted-input exposure
 * applies to every current caller — the totality requirement is unchanged.
 *
 * Rule for anyone editing this file: never index into a field of `graph`,
 * `sequential_metadata` or a stage without first proving its shape. Malformed
 * input must produce a typed issue, never a throw.
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

/** Total array read — untrusted input may put anything here. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Human-readable stage reference for issue messages, safe on a missing label. */
function stageRef(stage: StageDefinition): string {
  const label = typeof stage.label === 'string' ? stage.label : '';
  return label ? `${stage.index} ("${label}")` : `${stage.index}`;
}

/**
 * Read a stage's list of node IDs without trusting the declared type.
 *
 * `StageDefinition` declares `decisions` and `resolved_uncertainties` as
 * required `string[]`, but nothing validates the wire payload against that, so
 * both may be absent or the wrong type. Neither case can be fatal: both routes
 * derive their stages from `node.stage`, not from these lists, so the analysis
 * is still computable — the omission is reported as a warning and the list is
 * treated as empty rather than silently ignored.
 *
 * Pass `issues` only where the report should be recorded; internal re-reads
 * omit it so the same omission is not reported twice.
 */
function readStageIdList(
  stage: StageDefinition,
  field: 'decisions' | 'resolved_uncertainties',
  issues?: SequentialValidationIssue[]
): string[] {
  const raw = (stage as unknown as Record<string, unknown>)[field];

  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string');
  }

  if (raw === undefined || raw === null) {
    issues?.push({
      code: 'MISSING_STAGE_ID_LIST',
      message: `Stage ${stageRef(stage)} is missing "${field}". Treating it as empty — supply "${field}" as an array of node IDs for complete sequential validation.`,
      severity: 'warning',
    });
  } else {
    issues?.push({
      code: 'INVALID_STAGE_ID_LIST',
      message: `Stage ${stageRef(stage)} has "${field}" of type ${typeof raw}, expected an array of node IDs. Treating it as empty.`,
      severity: 'warning',
    });
  }

  return [];
}

/**
 * Filter `stages` down to entries that are actually stage objects, reporting
 * each reject as a typed error issue.
 */
function readStageDefinitions(
  rawStages: unknown[],
  issues: SequentialValidationIssue[]
): StageDefinition[] {
  const stages: StageDefinition[] = [];

  rawStages.forEach((entry, i) => {
    const isStageObject =
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as { index?: unknown }).index === 'number' &&
      Number.isFinite((entry as { index: number }).index);

    if (!isStageObject) {
      issues.push({
        code: 'INVALID_STAGE_DEFINITION',
        message: `sequential_metadata.stages[${i}] is not a valid stage definition — expected an object with a numeric "index", received ${entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry}.`,
        severity: 'error',
      });
      return;
    }

    stages.push(entry as StageDefinition);
  });

  return stages;
}

/**
 * Validate sequential graph metadata and node assignments
 */
export function validateSequentialGraph(graph: Graph): SequentialValidationResult {
  const issues: SequentialValidationIssue[] = [];
  const graphNodes = asArray<GraphNode>(graph?.nodes);
  const graphEdges = asArray<GraphEdge>(graph?.edges);
  const nodeMap = new Map<string, GraphNode>(graphNodes.map((n) => [n.id, n]));
  const edgeMap = buildEdgeMap(graphEdges);
  const nodesByStage = new Map<number, string[]>();

  // If no sequential_metadata, check for node-level stage assignments
  if (!graph?.sequential_metadata) {
    // Collect nodes with stage assignments
    for (const node of graphNodes) {
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

  const { stages: rawStages, is_sequential } = graph.sequential_metadata;

  if (!is_sequential) {
    return {
      valid: true,
      issues: [],
      stage_count: 0,
      nodes_by_stage: new Map(),
    };
  }

  // `stages` is untrusted: a non-array here used to reach `stages.map` and throw.
  if (!Array.isArray(rawStages)) {
    issues.push({
      code: 'INVALID_SEQUENTIAL_METADATA',
      message: `sequential_metadata.stages must be an array of stage definitions, received ${rawStages === null ? 'null' : typeof rawStages}.`,
      severity: 'error',
    });
    return {
      valid: false,
      issues,
      stage_count: 0,
      nodes_by_stage: nodesByStage,
    };
  }

  const stages = readStageDefinitions(rawStages, issues);

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
    const decisions = readStageIdList(stage, 'decisions', issues);
    const resolvedUncertainties = readStageIdList(stage, 'resolved_uncertainties', issues);

    // Check decisions exist in graph
    for (const decisionId of decisions) {
      const node = nodeMap.get(decisionId);
      if (!node) {
        issues.push({
          code: 'MISSING_DECISION_NODE',
          message: `Stage ${stageRef(stage)} references decision node "${decisionId}" which does not exist in graph.`,
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
    for (const uncId of resolvedUncertainties) {
      const node = nodeMap.get(uncId);
      if (!node) {
        issues.push({
          code: 'MISSING_UNCERTAINTY_NODE',
          message: `Stage ${stageRef(stage)} references uncertainty node "${uncId}" which does not exist in graph.`,
          severity: 'error',
          affected_ids: [uncId],
        });
      }
    }

    // Track nodes by stage
    const stageNodeIds = [...decisions, ...resolvedUncertainties];
    nodesByStage.set(stage.index, stageNodeIds);
  }

  // Validate node stage assignments match stage definitions
  for (const node of graphNodes) {
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
  for (const edge of graphEdges) {
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
  if (discountFactor !== undefined && discountFactor !== null) {
    if (typeof discountFactor !== 'number' || !Number.isFinite(discountFactor)) {
      issues.push({
        code: 'INVALID_DISCOUNT_FACTOR',
        message: `Discount factor must be a number between 0 and 1, received ${typeof discountFactor}.`,
        severity: 'error',
      });
    } else if (discountFactor < 0 || discountFactor > 1) {
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
  for (const node of asArray<GraphNode>(graph?.nodes)) {
    if (node?.stage !== undefined) {
      nodeStages.set(node.id, node.stage);
    }
  }

  // Then, fill in from stage definitions. Re-reads the id lists without an
  // `issues` sink: any malformation here was already reported by the caller.
  for (const stage of asArray<StageDefinition>(graph?.sequential_metadata?.stages)) {
    if (!stage || typeof stage !== 'object' || typeof stage.index !== 'number') continue;
    const ids = [
      ...readStageIdList(stage, 'decisions'),
      ...readStageIdList(stage, 'resolved_uncertainties'),
    ];
    for (const id of ids) {
      if (!nodeStages.has(id)) {
        nodeStages.set(id, stage.index);
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
  for (const edge of asArray<GraphEdge>(edges)) {
    if (!edge || typeof edge !== 'object') continue;
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
  if (graph?.sequential_metadata?.is_sequential) {
    return true;
  }

  // Check for node-level stage assignments
  return asArray<GraphNode>(graph?.nodes).some((n) => n?.stage !== undefined);
}

/**
 * Get maximum stage index in graph (0 if not sequential)
 */
export function getMaxStage(graph: Graph): number {
  let maxStage = 0;

  for (const stage of asArray<StageDefinition>(graph?.sequential_metadata?.stages)) {
    if (typeof stage?.index === 'number' && Number.isFinite(stage.index)) {
      maxStage = Math.max(maxStage, stage.index);
    }
  }

  for (const node of asArray<GraphNode>(graph?.nodes)) {
    if (typeof node?.stage === 'number' && Number.isFinite(node.stage)) {
      maxStage = Math.max(maxStage, node.stage);
    }
  }

  return maxStage;
}
