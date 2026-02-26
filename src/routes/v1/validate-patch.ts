/**
 * POST /v1/validate-patch
 *
 * Applies sequential patch operations to a graph and validates the result.
 * Feature-flagged behind ENABLE_VALIDATE_PATCH.
 *
 * 5-phase pipeline:
 *   1. Apply operations sequentially
 *   2. Structural pre-check (limits, cycles, dangling refs)
 *   3. Semantic repairs (defaults, clamping, direction inference)
 *   4. Full schema validation
 *   5. Compute deterministic graph hash
 *
 * @see openapi/openapi-plot-lite-v1.yaml — /v1/validate-patch path
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type {
  ValidatePatchRequest,
  ValidatePatchResponse,
  ValidatePatchRejection,
  PatchOperation,
  ValidationWarning,
  ViolationV3,
} from './validate-patch.types.js';
import type { EngineNodeV3, EngineEdgeV3, EngineNodeKindV3 } from '../../types/engine-v3.js';
import { FLAGS } from '../../config/flags.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';
import { normaliseGraphWithRepairs, NormalisationError, REPAIR_CODES } from '../../normalisation/normalise-and-repair.js';
import type { RepairEntry } from '../../normalisation/repair-codes.js';

// =============================================================================
// Constants
// =============================================================================

const CASCADE_WARNING_CAP = 10;

/**
 * Valid node kinds for validate-patch.
 * Includes EngineNodeKindV3 values plus 'option' (present in UI graphs,
 * filtered before analysis by /v2/run).
 *
 * Cross-layer note: validate-patch operates on UI-layer graphs (pre-analysis-filter).
 * 'option' is a valid UI node kind, stripped by /v2/run before inference.
 * Included here to prevent false rejections on graphs that haven't been filtered yet.
 */
const VALID_NODE_KINDS = new Set<string>([
  'goal', 'factor', 'outcome', 'decision', 'risk', 'action', 'option',
] satisfies (EngineNodeKindV3 | 'option')[]);

// Canonical field allow-lists for patch operations
const CANONICAL_EDGE_FIELDS = new Set([
  'from', 'to', 'strength', 'exists_probability', 'effect_direction', 'label', 'edge_type',
]);
const CANONICAL_NODE_FIELDS = new Set([
  'id', 'kind', 'label', 'body', 'type', 'categories', 'category',
  'observed_state', 'state_space', 'goal_threshold', 'goal_threshold_raw',
  'goal_threshold_unit', 'goal_threshold_cap', 'prior',
]);

/**
 * Validate that a patch operation value contains only canonical field names.
 * Throws with INVALID_PATCH_FIELD details if non-canonical fields are found.
 */
function validateCanonicalFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
  opIndex: number,
  entityType: 'edge' | 'node'
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new InvalidPatchFieldError(
        `Operation ${opIndex} contains non-canonical ${entityType} field "${key}". Use canonical field names (${[...allowedFields].join(', ')}).`,
        key
      );
    }
  }
}

class InvalidPatchFieldError extends Error {
  readonly field: string;
  constructor(message: string, field: string) {
    super(message);
    this.field = field;
  }
}

// =============================================================================
// Graph State
// =============================================================================

interface GraphState {
  nodes: EngineNodeV3[];
  edges: EngineEdgeV3[];
}

/**
 * Deep clone a graph
 */
function cloneGraph(graph: { nodes: EngineNodeV3[]; edges: EngineEdgeV3[] }): GraphState {
  return {
    nodes: JSON.parse(JSON.stringify(graph.nodes)),
    edges: JSON.parse(JSON.stringify(graph.edges)),
  };
}

/**
 * Deep merge value onto target (recursive for objects, replace for arrays)
 */
function deepMerge(target: any, value: any): any {
  if (value === null) return null;
  if (value === undefined) return target;
  if (Array.isArray(value)) return value; // Arrays: replace entirely
  if (typeof value === 'object' && typeof target === 'object') {
    const result = { ...target };
    for (const key in value) {
      result[key] = deepMerge(result[key], value[key]);
    }
    return result;
  }
  return value;
}

/**
 * Find edge by from->to key
 */
function findEdgeIndex(edges: EngineEdgeV3[], from: string, to: string): number {
  return edges.findIndex(e => e.from === from && e.to === to);
}

// =============================================================================
// Phase 1: Apply Operations
// =============================================================================

function applyOperation(
  state: GraphState,
  op: PatchOperation,
  opIndex: number,
  repairs: RepairEntry[],
  warnings: ValidationWarning[]
): void {
  switch (op.op) {
    case 'add_node': {
      if (!op.value) throw new Error(`Operation ${opIndex}: add_node requires 'value'`);
      validateCanonicalFields(op.value as Record<string, unknown>, CANONICAL_NODE_FIELDS, opIndex, 'node');
      const nodeId = (op.value as EngineNodeV3).id || op.path;
      if (state.nodes.some(n => n.id === nodeId)) {
        throw new Error(`Operation ${opIndex} references node '${nodeId}' which already exists`);
      }
      state.nodes.push({ ...op.value, id: nodeId } as EngineNodeV3);
      break;
    }

    case 'add_edge': {
      if (!op.value) throw new Error(`Operation ${opIndex}: add_edge requires 'value'`);
      validateCanonicalFields(op.value as Record<string, unknown>, CANONICAL_EDGE_FIELDS, opIndex, 'edge');
      const edge = op.value as EngineEdgeV3;
      const edgeKey = `${edge.from}->${edge.to}`;
      if (findEdgeIndex(state.edges, edge.from, edge.to) !== -1) {
        throw new Error(`Operation ${opIndex} references edge '${edgeKey}' which already exists`);
      }
      state.edges.push({ ...edge } as EngineEdgeV3);
      break;
    }

    case 'remove_node': {
      const nodeId = op.path;
      const nodeIndex = state.nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) {
        throw new Error(`Operation ${opIndex} references node '${nodeId}' which does not exist after applying prior operations`);
      }
      state.nodes.splice(nodeIndex, 1);
      const connectedEdges = state.edges.filter(e => e.from === nodeId || e.to === nodeId);
      state.edges = state.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
      for (const edge of connectedEdges) {
        const edgeId = `${edge.from}->${edge.to}`;
        repairs.push({
          code: REPAIR_CODES.CASCADE_REMOVE_EDGE,
          layer: 'plot',
          field_path: edgeId,
          before: { id: edgeId, from: edge.from, to: edge.to },
          after: null,
          reason: `Edge removed because connected node ${nodeId} was removed`,
          severity: 'info',
          action: 'removed',
        });
      }
      const cascadeCount = connectedEdges.length;
      if (cascadeCount > 0) {
        for (let i = 0; i < Math.min(CASCADE_WARNING_CAP, cascadeCount); i++) {
          const edge = connectedEdges[i];
          warnings.push({
            code: 'CASCADE_REMOVE_EDGE',
            message: `Edge ${edge.from}->${edge.to} removed because connected node ${nodeId} was removed`,
            field_path: `${edge.from}->${edge.to}`,
          });
        }
        if (cascadeCount > CASCADE_WARNING_CAP) {
          warnings.push({
            code: 'CASCADE_REMOVE_EDGE_SUMMARY',
            message: `Removed ${cascadeCount} edges connected to node ${nodeId}`,
            field_path: nodeId,
          });
        }
      }
      break;
    }

    case 'remove_edge': {
      const [from, to] = op.path.split('->');
      if (!from || !to) {
        throw new Error(`Operation ${opIndex}: invalid edge path '${op.path}' (expected 'from->to')`);
      }
      const edgeIndex = findEdgeIndex(state.edges, from, to);
      if (edgeIndex === -1) {
        throw new Error(`Operation ${opIndex} references edge '${op.path}' which does not exist after applying prior operations`);
      }
      state.edges.splice(edgeIndex, 1);
      break;
    }

    case 'update_node': {
      if (!op.value) throw new Error(`Operation ${opIndex}: update_node requires 'value'`);
      validateCanonicalFields(op.value as Record<string, unknown>, CANONICAL_NODE_FIELDS, opIndex, 'node');
      const nodeId = op.path;
      const nodeIndex = state.nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) {
        throw new Error(`Operation ${opIndex} references node '${nodeId}' which does not exist after applying prior operations`);
      }
      state.nodes[nodeIndex] = deepMerge(state.nodes[nodeIndex], op.value);
      break;
    }

    case 'update_edge': {
      if (!op.value) throw new Error(`Operation ${opIndex}: update_edge requires 'value'`);
      validateCanonicalFields(op.value as Record<string, unknown>, CANONICAL_EDGE_FIELDS, opIndex, 'edge');
      const [from, to] = op.path.split('->');
      if (!from || !to) {
        throw new Error(`Operation ${opIndex}: invalid edge path '${op.path}' (expected 'from->to')`);
      }
      const edgeIndex = findEdgeIndex(state.edges, from, to);
      if (edgeIndex === -1) {
        throw new Error(`Operation ${opIndex} references edge '${op.path}' which does not exist after applying prior operations`);
      }
      state.edges[edgeIndex] = deepMerge(state.edges[edgeIndex], op.value);
      break;
    }

    default:
      throw new Error(`Operation ${opIndex}: unknown operation '${(op as any).op}'`);
  }
}

// =============================================================================
// Phase 2: Structural Pre-Check
// =============================================================================

function detectCycles(nodes: EngineNodeV3[], edges: EngineEdgeV3[]): string[][] {
  const cycles: string[][] = [];
  const adjList = new Map<string, string[]>();
  for (const node of nodes) {
    adjList.set(node.id, []);
  }
  for (const edge of edges) {
    const neighbors = adjList.get(edge.from);
    if (neighbors) {
      neighbors.push(edge.to);
    }
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);
    const neighbors = adjList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        const cycleStartIndex = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStartIndex), neighbor]);
        return true;
      }
    }
    path.pop();
    recStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }
  return cycles;
}

function structuralPreCheck(graph: GraphState): ViolationV3[] {
  const violations: ViolationV3[] = [];

  if (graph.nodes.length > MAX_NODES) {
    violations.push({
      code: 'POC_NODE_LIMIT',
      message: `Graph exceeds maximum node limit (${graph.nodes.length} > ${MAX_NODES})`,
    });
  }
  if (graph.edges.length > MAX_EDGES) {
    violations.push({
      code: 'POC_EDGE_LIMIT',
      message: `Graph exceeds maximum edge limit (${graph.edges.length} > ${MAX_EDGES})`,
    });
  }

  const nodeIdPattern = /^[a-z0-9_:-]+$/;
  for (const node of graph.nodes) {
    if (!nodeIdPattern.test(node.id)) {
      violations.push({
        code: 'INVALID_NODE_ID',
        message: `Node ID '${node.id}' contains invalid characters (must match ^[a-z0-9_:-]+$)`,
        node_id: node.id,
      });
    }
    if (node.kind !== undefined && !VALID_NODE_KINDS.has(node.kind)) {
      violations.push({
        code: 'INVALID_NODE_KIND',
        message: `Node '${node.id}' has invalid kind '${node.kind}'. Allowed: ${[...VALID_NODE_KINDS].join(', ')}`,
        node_id: node.id,
      });
    }
  }

  const nodeIds = new Set(graph.nodes.map(n => n.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      violations.push({
        code: 'DANGLING_EDGE',
        message: `Edge references non-existent source node '${edge.from}'`,
        edge_id: `${edge.from}->${edge.to}`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      violations.push({
        code: 'DANGLING_EDGE',
        message: `Edge references non-existent target node '${edge.to}'`,
        edge_id: `${edge.from}->${edge.to}`,
      });
    }
  }

  const cycles = detectCycles(graph.nodes, graph.edges);
  if (cycles.length > 0) {
    violations.push({
      code: 'CYCLE_DETECTED',
      message: `Graph contains cycles: ${cycles.map(c => c.join(' -> ')).join('; ')}`,
    });
  }

  return violations;
}

// =============================================================================
// Phase 4: Full Schema Validation
// =============================================================================

function fullSchemaValidation(graph: GraphState): ViolationV3[] {
  const violations: ViolationV3[] = [];

  for (const edge of graph.edges) {
    const edgeId = `${edge.from}->${edge.to}`;
    if (edge.exists_probability !== undefined) {
      if (edge.exists_probability < 0 || edge.exists_probability > 1) {
        violations.push({
          code: 'INVALID_EXISTS_PROBABILITY',
          message: `Edge exists_probability must be in [0,1], got ${edge.exists_probability}`,
          edge_id: edgeId,
        });
      }
    }
    if (edge.strength?.std !== undefined) {
      if (edge.strength.std <= 0) {
        violations.push({
          code: 'INVALID_STRENGTH_STD',
          message: `Edge strength.std must be > 0, got ${edge.strength.std}`,
          edge_id: edgeId,
        });
      }
    }
    if (edge.strength?.mean !== undefined) {
      if (!Number.isFinite(edge.strength.mean)) {
        violations.push({
          code: 'INVALID_STRENGTH_MEAN',
          message: `Edge strength.mean must be finite, got ${edge.strength.mean}`,
          edge_id: edgeId,
        });
      }
    }
  }

  return violations;
}

// =============================================================================
// Phase 5: Compute Graph Hash
// =============================================================================

function computeGraphHash(graph: GraphState): string {
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const sortedEdges = [...graph.edges].sort((a, b) => {
    if (a.from < b.from) return -1;
    if (a.from > b.from) return 1;
    if (a.to < b.to) return -1;
    if (a.to > b.to) return 1;
    return 0;
  });
  const canonical = { nodes: sortedNodes, edges: sortedEdges };
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16);
}

// =============================================================================
// Route Registration
// =============================================================================

export async function registerValidatePatchRoute(app: FastifyInstance) {
  app.post<{ Body: ValidatePatchRequest }>(
    '/v1/validate-patch',
    async (
      req: FastifyRequest<{ Body: ValidatePatchRequest }>,
      reply: FastifyReply
    ): Promise<ValidatePatchResponse | ValidatePatchRejection> => {
      // Feature flag check (getter — not frozen)
      if (!FLAGS.ENABLE_VALIDATE_PATCH) {
        return reply.code(501).send({
          status: 'rejected',
          code: 'FEATURE_DISABLED',
          message: 'validate-patch is not enabled',
        });
      }

      // Body guard — Fastify needs Content-Type: application/json to parse body
      if (!req.body || typeof req.body !== 'object') {
        return reply.code(400).send({
          status: 'rejected',
          code: 'INVALID_REQUEST',
          message: 'Request body is missing or not JSON. Ensure Content-Type: application/json header is set.',
        });
      }

      const { graph, operations } = req.body;

      // Guard: graph and operations must be present
      if (!graph || typeof graph !== 'object' || !Array.isArray(operations)) {
        return reply.code(400).send({
          status: 'rejected',
          code: 'INVALID_REQUEST',
          message: 'Request body must include "graph" (object) and "operations" (array).',
        });
      }

      // Phase 1: Apply operations sequentially
      const state = cloneGraph(graph);
      const repairs: RepairEntry[] = [];
      const warnings: ValidationWarning[] = [];

      try {
        for (let i = 0; i < operations.length; i++) {
          applyOperation(state, operations[i], i, repairs, warnings);
        }
      } catch (err) {
        if (err instanceof InvalidPatchFieldError) {
          return reply.code(422).send({
            status: 'rejected',
            code: 'INVALID_PATCH_FIELD',
            message: err.message,
          });
        }
        return reply.code(422).send({
          status: 'rejected',
          code: 'INVALID_PATCH_TARGET',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // Phase 2: Structural pre-check
      const structuralViolations = structuralPreCheck(state);
      if (structuralViolations.length > 0) {
        const codes = structuralViolations.map(v => v.code);
        let rejectionCode = 'VALIDATION_FAILED';
        if (codes.includes('CYCLE_DETECTED')) {
          rejectionCode = 'CYCLE_DETECTED';
        } else if (codes.includes('POC_EDGE_LIMIT')) {
          rejectionCode = 'POC_EDGE_LIMIT';
        } else if (codes.includes('POC_NODE_LIMIT')) {
          rejectionCode = 'POC_NODE_LIMIT';
        } else if (codes.includes('INVALID_NODE_KIND')) {
          rejectionCode = 'INVALID_NODE_KIND';
        }
        return reply.code(422).send({
          status: 'rejected',
          code: rejectionCode,
          message: structuralViolations[0].message,
          violations: structuralViolations,
        });
      }

      // Phase 3: Shared normaliser (parity with /v2/run)
      // Runs the SAME normalisation pipeline used by /v2/run, ensuring
      // "accepted" means "this is the canonical form the UI should adopt."
      let normalisedGraph: GraphState;
      try {
        const normResult = normaliseGraphWithRepairs(state);
        normalisedGraph = normResult.graph;
        repairs.push(...normResult.repairs);

        // Convert informational warnings to ValidationWarning format
        for (const w of normResult.warnings) {
          warnings.push({
            code: w.code,
            message: w.message,
            field_path: w.node_id ?? w.edge_id ?? '',
          });
        }
      } catch (err) {
        if (err instanceof NormalisationError) {
          return reply.code(422).send({
            status: 'rejected',
            code: 'VALIDATION_FAILED',
            message: `Normalisation failed: ${err.message}`,
          });
        }
        throw err;
      }

      // Phase 4: Full schema validation (post-normalisation)
      const schemaViolations = fullSchemaValidation(normalisedGraph);
      if (schemaViolations.length > 0) {
        return reply.code(422).send({
          status: 'rejected',
          code: 'VALIDATION_FAILED',
          message: schemaViolations[0].message,
          violations: schemaViolations,
        });
      }

      // Phase 5: Compute graph hash (on normalised graph)
      const graphHash = computeGraphHash(normalisedGraph);

      return reply.code(200).send({
        status: 'applied',
        graph: state,
        // Contract: normalised_graph is the canonical form the UI should adopt after patch acceptance.
        normalised_graph: normalisedGraph,
        graph_hash: graphHash,
        repairs_applied: repairs,
        warnings,
      });
    }
  );
}
