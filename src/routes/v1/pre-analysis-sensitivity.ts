/**
 * POST /v1/pre-analysis-sensitivity — Lightweight factor & edge influence
 *
 * Returns approximate factor and edge influence via linear path approximation,
 * without running a full MC simulation. Used by the UI pre-analysis tab to
 * sort factors by importance and show "Drives N%" labels.
 *
 * Input:  GraphV3 (same shape as /v2/run input graph) + goal_node_id
 * Output: PreAnalysisSensitivity
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { normaliseGraph, NormalisationError } from '../../normalisation/graph-normaliser.js';
import { computePreAnalysisSensitivity } from '../../lib/pre-analysis-sensitivity.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';
import type { UpstreamGraph } from '../../types/engine-v3.js';

interface PreAnalysisSensitivityRequest {
  graph: UpstreamGraph;
  goal_node_id: string;
}

export async function registerPreAnalysisSensitivityRoute(app: FastifyInstance) {
  app.post('/v1/pre-analysis-sensitivity', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as PreAnalysisSensitivityRequest;

    // --- Input validation ---
    if (!body.graph || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph with nodes[] and edges[] is required',
        fields: { field: 'graph' },
      });
    }

    // --- Graph size guardrails ---
    if (body.graph.nodes.length > MAX_NODES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Graph has ${body.graph.nodes.length} nodes, exceeding the limit of ${MAX_NODES}`,
        fields: { field: 'graph.nodes' },
      });
    }
    if (body.graph.edges.length > MAX_EDGES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Graph has ${body.graph.edges.length} edges, exceeding the limit of ${MAX_EDGES}`,
        fields: { field: 'graph.edges' },
      });
    }

    if (!body.goal_node_id || typeof body.goal_node_id !== 'string') {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'goal_node_id is required',
        fields: { field: 'goal_node_id' },
      });
    }

    // --- Normalise graph ---
    let normalised;
    try {
      normalised = normaliseGraph(body.graph);
    } catch (err) {
      if (err instanceof NormalisationError) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Graph normalisation failed: ${err.message}`,
          fields: { field: err.field, nodeId: err.nodeId, edgeId: err.edgeId },
        });
      }
      throw err;
    }

    // --- Validate goal node exists ---
    const goalExists = normalised.graph.nodes.some(n => n.id === body.goal_node_id);
    if (!goalExists) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `goal_node_id "${body.goal_node_id}" not found in graph nodes`,
        fields: { field: 'goal_node_id' },
      });
    }

    // --- Compute ---
    const result = computePreAnalysisSensitivity(normalised.graph, body.goal_node_id);

    req.log.info({
      evt: 'pre_analysis_sensitivity',
      id: req.id,
      route: '/v1/pre-analysis-sensitivity',
      method: result.method,
      factors: Object.keys(result.factor_influence).length,
      edges: Object.keys(result.edge_influence).length,
      computation_ms: result.computation_ms,
    }, 'pre-analysis sensitivity computed');

    return reply.code(200).send(result);
  });
}
