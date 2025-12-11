/**
 * POST /v1/analysis/policy-tree - Policy Tree Generation Proxy
 *
 * Builds a decision tree representation of multi-stage decisions,
 * then forwards to ISL /api/v1/analysis/policy-tree for optimal policy.
 *
 * Phase 4: Sequential graph support
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { validateSequentialGraph, getMaxStage } from '../../util/sequential-validation.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  PolicyTreeRequest,
  PolicyTreeResponse,
  IslPolicyTreeResponse,
  PolicyTreeNode,
} from './types/proxy.types.js';

const MAX_NODES = 50;
const MAX_EDGES = 200;
const MAX_STAGES = 10;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_K_SAMPLES = 32;
const ISL_TIMEOUT_MS = Number(process.env.ISL_TIMEOUT_MS || 30_000);

/**
 * Call ISL /api/v1/analysis/policy-tree endpoint
 */
async function callIslPolicyTree(
  body: {
    plot_request_id: string;
    tree_nodes: PolicyTreeNode[];
    root_id: string;
    max_depth: number;
  },
  logger?: any
): Promise<{
  tree: IslPolicyTreeResponse | null;
  error?: { code: string; message: string; retryable: boolean };
}> {
  const baseUrl = process.env.ISL_BASE_URL?.trim();
  const apiKey = process.env.ISL_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      tree: null,
      error: {
        code: 'ISL_CONFIG_MISSING',
        message: 'ISL_BASE_URL or ISL_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/analysis/policy-tree`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ISL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Request-Id': body.plot_request_id,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger?.warn({
        evt: 'isl_policy_tree_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        tree: null,
        error: {
          code: `ISL_HTTP_${res.status}`,
          message: `ISL returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { tree: data as IslPolicyTreeResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'isl_policy_tree_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      tree: null,
      error: {
        code: isTimeout ? 'ISL_TIMEOUT' : 'ISL_FETCH_ERROR',
        message: err.message || 'Failed to fetch from ISL',
        retryable: true,
      },
    };
  }
}

/**
 * Build policy tree from graph structure
 */
function buildPolicyTree(
  graph: any,
  nodeScores: Map<string, number>,
  maxDepth: number
): { nodes: PolicyTreeNode[]; rootId: string } {
  const treeNodes: PolicyTreeNode[] = [];
  let nodeCounter = 0;

  // Find decision/option nodes by stage
  const nodesByStage = new Map<number, any[]>();
  for (const node of graph.nodes) {
    const stage = node.stage ?? 0;
    const stageNodes = nodesByStage.get(stage) ?? [];
    stageNodes.push(node);
    nodesByStage.set(stage, stageNodes);
  }

  const stages = [...nodesByStage.keys()].sort((a, b) => a - b);
  const rootId = `tree_root`;

  // Create root node
  treeNodes.push({
    id: rootId,
    type: 'decision',
    label: 'Start',
    stage: 0,
    expected_value: 0,
    children: [],
  });

  // Build tree recursively by stage
  function buildStageNodes(
    parentId: string,
    stageIndex: number,
    depth: number
  ): void {
    if (depth >= maxDepth || stageIndex >= stages.length) return;

    const stage = stages[stageIndex];
    const stageNodes = nodesByStage.get(stage) ?? [];

    // Find decision/option nodes
    const decisionNodes = stageNodes.filter(
      (n: any) =>
        n.kind === 'decision' || n.kind === 'option' || n.kind === 'action'
    );

    for (const node of decisionNodes) {
      const nodeId = `tree_${++nodeCounter}`;
      const score = nodeScores.get(node.id) ?? 0;

      const treeNode: PolicyTreeNode = {
        id: nodeId,
        type: node.kind === 'decision' ? 'decision' : 'chance',
        label: node.label || node.id,
        stage,
        action: node.id,
        expected_value: Math.round(score * 1000) / 1000,
        children: [],
      };

      treeNodes.push(treeNode);

      // Link to parent
      const parentNode = treeNodes.find((n) => n.id === parentId);
      if (parentNode) {
        parentNode.children.push(nodeId);
      }

      // Recurse to next stage
      buildStageNodes(nodeId, stageIndex + 1, depth + 1);
    }

    // If no decision nodes, add outcome nodes
    if (decisionNodes.length === 0) {
      const outcomeNodes = stageNodes.filter((n: any) => n.kind === 'outcome');
      for (const node of outcomeNodes) {
        const nodeId = `tree_${++nodeCounter}`;
        const score = nodeScores.get(node.id) ?? node.value ?? 0;

        const treeNode: PolicyTreeNode = {
          id: nodeId,
          type: 'outcome',
          label: node.label || node.id,
          stage,
          expected_value: Math.round(score * 1000) / 1000,
          children: [],
        };

        treeNodes.push(treeNode);

        const parentNode = treeNodes.find((n) => n.id === parentId);
        if (parentNode) {
          parentNode.children.push(nodeId);
        }
      }
    }
  }

  buildStageNodes(rootId, 0, 0);

  // Calculate expected values bottom-up
  function calculateExpectedValues(nodeId: string): number {
    const node = treeNodes.find((n) => n.id === nodeId);
    if (!node) return 0;

    if (node.children.length === 0) {
      return node.expected_value;
    }

    const childValues = node.children.map((childId) =>
      calculateExpectedValues(childId)
    );

    if (node.type === 'decision') {
      // Decision: pick best child
      node.expected_value = Math.max(...childValues);
    } else {
      // Chance: average of children
      node.expected_value =
        childValues.reduce((a, b) => a + b, 0) / childValues.length;
    }

    return node.expected_value;
  }

  calculateExpectedValues(rootId);

  return { nodes: treeNodes, rootId };
}

/**
 * Generate local policy summary
 */
function generatePolicySummary(nodes: PolicyTreeNode[], rootId: string): string {
  const root = nodes.find((n) => n.id === rootId);
  if (!root) return 'No policy tree generated';

  // Find optimal path
  const optimalPath: string[] = [];
  let current = root;

  while (current && current.children.length > 0) {
    const children = current.children.map((id) => nodes.find((n) => n.id === id)!);
    const bestChild = children.reduce((best, child) =>
      child.expected_value > best.expected_value ? child : best
    );

    if (bestChild.type === 'decision') {
      optimalPath.push(bestChild.label);
    }
    current = bestChild;
  }

  if (optimalPath.length === 0) {
    return `Expected value: ${root.expected_value}`;
  }

  return `Optimal path: ${optimalPath.join(' → ')} (EV: ${root.expected_value})`;
}

export async function registerPolicyTreeRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/policy-tree',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as PolicyTreeRequest;
      const requestId = String(req.id);

      // Validate graph
      if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required',
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.nodes.length > MAX_NODES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_NODES} nodes`,
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.edges && body.graph.edges.length > MAX_EDGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_EDGES} edges`,
          fields: { field: 'graph.edges' },
        });
      }

      const maxDepth = Math.min(body.max_depth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH);

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
        sequential_metadata: body.graph.sequential_metadata,
      };

      // Validate sequential structure
      const validation = validateSequentialGraph(graph);
      const maxStage = getMaxStage(graph);

      if (maxStage > MAX_STAGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_STAGES} stages`,
          fields: { field: 'graph.sequential_metadata.stages' },
        });
      }

      // Detect outcome node
      const seed = body.seed ?? 4242;
      let outcomeNode = body.outcome_node ?? '';

      if (!outcomeNode) {
        const detection = detectPrimaryOutcome(graph);
        if (detection.detected && detection.node_id) {
          outcomeNode = detection.node_id;
        } else {
          outcomeNode = graph.nodes[graph.nodes.length - 1]?.id ?? '';
        }
      }

      // Run inference for each node to get scores
      const inferenceEngine = getInferenceEngine('model_based');
      const nodeScores = new Map<string, number>();

      for (let i = 0; i < graph.nodes.length; i++) {
        const node = graph.nodes[i];
        const nodeSeed = seed + i + 1;

        try {
          const result = await inferenceEngine.run(graph, {
            seed: nodeSeed,
            k_samples: DEFAULT_K_SAMPLES,
            outcome_node: outcomeNode,
            baseline_value: 100,
            adaptiveK: true,
          });

          nodeScores.set(node.id, result.most_likely.outcome);
        } catch (err: any) {
          req.log.warn({
            evt: 'policy_tree_inference_error',
            node_id: node.id,
            error: err.message,
          });
          nodeScores.set(node.id, node.value ?? 0);
        }
      }

      // Build policy tree
      const { nodes: treeNodes, rootId } = buildPolicyTree(
        graph,
        nodeScores,
        maxDepth
      );

      // Count terminal nodes
      const terminalCount = treeNodes.filter((n) => n.children.length === 0).length;
      const treeDepth = Math.max(...treeNodes.map((n) => n.stage)) + 1;

      // Call ISL if enabled
      let tree: IslPolicyTreeResponse | null = null;
      let islError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';

      const islEnabled = isFlagOn(
        process.env.ISL_POLICY_TREE_ENABLE ?? process.env.ISL_ENABLE
      );

      if (islEnabled && treeNodes.length > 1) {
        req.log.info({
          evt: 'policy_tree_isl_call',
          id: requestId,
          node_count: treeNodes.length,
          depth: treeDepth,
        });

        const islResult = await callIslPolicyTree(
          {
            plot_request_id: requestId,
            tree_nodes: treeNodes,
            root_id: rootId,
            max_depth: maxDepth,
          },
          req.log
        );

        tree = islResult.tree;
        islError = islResult.error;

        if (tree) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable
      if (!tree) {
        tree = {
          root_id: rootId,
          nodes: treeNodes,
          depth: treeDepth,
          terminal_count: terminalCount,
          policy_summary: generatePolicySummary(treeNodes, rootId),
        };
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'policy_tree_analysis',
        id: requestId,
        node_count: treeNodes.length,
        depth: treeDepth,
        terminal_count: terminalCount,
        provenance,
        duration_ms: duration,
      });

      const response: PolicyTreeResponse = {
        schema: 'policy_tree.v1',
        tree,
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          stages: maxStage + 1,
          max_depth: maxDepth,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
