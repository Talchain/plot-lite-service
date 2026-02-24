/**
 * POST /v1/validate-patch
 *
 * Applies sequential patch operations to a graph and validates the result.
 * Feature-flagged behind ENABLE_VALIDATE_PATCH.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type {
  ValidatePatchRequest,
  ValidatePatchResponse,
  ValidatePatchRejection,
  PatchOperation,
  RepairEntry,
  ValidationWarning,
  ViolationV3,
} from './validate-patch.types.js';
import type { EngineNodeV3, EngineEdgeV3 } from '../../types/engine-v3.js';
import { normalizeGraph } from '../../util/normalize.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

/**
 * Detect cycles in directed graph using DFS
 * Returns array of cycles (each cycle is array of node IDs)
 */
function detectCycles(nodes: EngineNodeV3[], edges: EngineEdgeV3[]): string[][] {
  const cycles: string[][] = [];
  const adjList = new Map<string, string[]>();

  // Build adjacency list
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
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recStack.has(neighbor)) {
        // Found a cycle
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

const ENABLE_VALIDATE_PATCH = process.env.ENABLE_VALIDATE_PATCH === '1';
const CASCADE_WARNING_CAP = 10;

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

/**
 * Apply a single patch operation to the graph state
 */
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
      const nodeId = (op.value as EngineNodeV3).id || op.path;

      // Check if node already exists
      if (state.nodes.some(n => n.id === nodeId)) {
        throw new Error(`Operation ${opIndex} references node '${nodeId}' which already exists`);
      }

      state.nodes.push({ ...op.value, id: nodeId } as EngineNodeV3);
      break;
    }

    case 'add_edge': {
      if (!op.value) throw new Error(`Operation ${opIndex}: add_edge requires 'value'`);
      const edge = op.value as EngineEdgeV3;

      // Check if edge already exists
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

      // Remove the node
      state.nodes.splice(nodeIndex, 1);

      // Cascade remove connected edges
      const connectedEdges = state.edges.filter(e => e.from === nodeId || e.to === nodeId);
      state.edges = state.edges.filter(e => e.from !== nodeId && e.to !== nodeId);

      // Log cascade removes
      for (const edge of connectedEdges) {
        const edgeId = `${edge.from}->${edge.to}`;
        repairs.push({
          code: 'CASCADE_REMOVE_EDGE',
          layer: 'plot',
          field_path: edgeId,
          before: { id: edgeId, from: edge.from, to: edge.to },
          after: null,
          reason: `Edge removed because connected node ${nodeId} was removed`,
          severity: 'info',
        });
      }

      // Add cascade warnings (capped at 10 individual warnings)
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

        // Add summary warning if more than cap
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
      // Parse edge key from->to
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
      const nodeId = op.path;
      const nodeIndex = state.nodes.findIndex(n => n.id === nodeId);

      if (nodeIndex === -1) {
        throw new Error(`Operation ${opIndex} references node '${nodeId}' which does not exist after applying prior operations`);
      }

      // Deep merge
      state.nodes[nodeIndex] = deepMerge(state.nodes[nodeIndex], op.value);
      break;
    }

    case 'update_edge': {
      if (!op.value) throw new Error(`Operation ${opIndex}: update_edge requires 'value'`);
      const [from, to] = op.path.split('->');
      if (!from || !to) {
        throw new Error(`Operation ${opIndex}: invalid edge path '${op.path}' (expected 'from->to')`);
      }

      const edgeIndex = findEdgeIndex(state.edges, from, to);
      if (edgeIndex === -1) {
        throw new Error(`Operation ${opIndex} references edge '${op.path}' which does not exist after applying prior operations`);
      }

      // Deep merge
      state.edges[edgeIndex] = deepMerge(state.edges[edgeIndex], op.value);
      break;
    }

    default:
      throw new Error(`Operation ${opIndex}: unknown operation '${(op as any).op}'`);
  }
}

/**
 * Validate graph structure and constraints
 */
function validateGraph(graph: GraphState): ViolationV3[] {
  const violations: ViolationV3[] = [];

  // Check limits
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

  // Check node ID pattern
  const nodeIdPattern = /^[a-z0-9_:-]+$/;
  for (const node of graph.nodes) {
    if (!nodeIdPattern.test(node.id)) {
      violations.push({
        code: 'INVALID_NODE_ID',
        message: `Node ID '${node.id}' contains invalid characters (must match ^[a-z0-9_:-]+$)`,
        node_id: node.id,
      });
    }
  }

  // Check reference integrity
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

  // Check for cycles
  const cycles = detectCycles(graph.nodes, graph.edges);
  if (cycles.length > 0) {
    violations.push({
      code: 'CYCLE_DETECTED',
      message: `Graph contains cycles: ${cycles.map(c => c.join(' -> ')).join('; ')}`,
    });
  }

  // Edge schema validation
  for (const edge of graph.edges) {
    const edgeId = `${edge.from}->${edge.to}`;

    // exists_probability must be in [0,1]
    if (edge.exists_probability !== undefined) {
      if (edge.exists_probability < 0 || edge.exists_probability > 1) {
        violations.push({
          code: 'INVALID_EXISTS_PROBABILITY',
          message: `Edge exists_probability must be in [0,1], got ${edge.exists_probability}`,
          edge_id: edgeId,
        });
      }
    }

    // strength.std must be > 0
    if (edge.strength?.std !== undefined) {
      if (edge.strength.std <= 0) {
        violations.push({
          code: 'INVALID_STRENGTH_STD',
          message: `Edge strength.std must be > 0, got ${edge.strength.std}`,
          edge_id: edgeId,
        });
      }
    }

    // strength.mean must be finite
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

/**
 * Run semantic repairs on the graph
 * Returns repairs applied and warnings generated
 */
function applySemanticRepairs(
  graph: GraphState
): { repairs: RepairEntry[]; warnings: ValidationWarning[] } {
  // Use normalizeGraph to apply all semantic repairs
  // This handles: clamping, defaulting, direction inference, etc.
  const normalized = normalizeGraph(graph, false);

  // Extract repairs from normalization diagnostics
  const repairs: RepairEntry[] = [];
  const warnings: ValidationWarning[] = [];

  // Update graph in-place with normalized values
  graph.nodes = normalized.nodes;
  graph.edges = normalized.edges;

  return { repairs, warnings };
}

/**
 * Compute deterministic canonical hash of graph
 */
function computeGraphHash(graph: GraphState): string {
  // Sort nodes by ID, edges by from then to (bytewise)
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

/**
 * Register /v1/validate-patch route
 */
export async function registerValidatePatchRoute(app: FastifyInstance) {
  app.post<{ Body: ValidatePatchRequest }>(
    '/v1/validate-patch',
    async (
      req: FastifyRequest<{ Body: ValidatePatchRequest }>,
      reply: FastifyReply
    ): Promise<ValidatePatchResponse | ValidatePatchRejection> => {
      // Feature flag check
      if (!ENABLE_VALIDATE_PATCH) {
        return reply.code(501).send({
          status: 'rejected',
          code: 'FEATURE_DISABLED',
          message: 'validate-patch is not enabled',
        });
      }

      const { graph, operations } = req.body;

      // Clone input graph
      const state = cloneGraph(graph);
      const repairs: RepairEntry[] = [];
      const warnings: ValidationWarning[] = [];

      // Apply operations sequentially
      try {
        for (let i = 0; i < operations.length; i++) {
          applyOperation(state, operations[i], i, repairs, warnings);
        }
      } catch (err) {
        // Operation application failed
        return reply.code(422).send({
          status: 'rejected',
          code: 'INVALID_PATCH_TARGET',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // Validate resulting graph
      const violations = validateGraph(state);
      if (violations.length > 0) {
        // Determine rejection code from violations
        const codes = violations.map(v => v.code);
        let rejectionCode = 'VALIDATION_FAILED';

        if (codes.includes('CYCLE_DETECTED')) {
          rejectionCode = 'CYCLE_DETECTED';
        } else if (codes.includes('POC_EDGE_LIMIT')) {
          rejectionCode = 'POC_EDGE_LIMIT';
        } else if (codes.includes('POC_NODE_LIMIT')) {
          rejectionCode = 'POC_NODE_LIMIT';
        }

        return reply.code(422).send({
          status: 'rejected',
          code: rejectionCode,
          message: violations[0].message,
          violations,
        });
      }

      // Apply semantic repairs
      const { repairs: semanticRepairs, warnings: semanticWarnings } =
        applySemanticRepairs(state);
      repairs.push(...semanticRepairs);
      warnings.push(...semanticWarnings);

      // Compute graph hash
      const graphHash = computeGraphHash(state);

      return reply.code(200).send({
        status: 'applied',
        graph: state,
        graph_hash: graphHash,
        repairs_applied: repairs,
        warnings,
      });
    }
  );
}
