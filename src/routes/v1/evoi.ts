/**
 * POST /v1/evoi — Expected Value of Information for contested edges
 *
 * Computes EVOI for edges where CEE validation found disagreement between
 * passes. Ranks which contested edge disagreements matter most to the
 * decision outcome.
 *
 * Input:  GraphV3 + goal_node_id + contested_edges[]
 * Output: EVOIResult
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { normaliseGraph, NormalisationError } from '../../normalisation/graph-normaliser.js';
import { computeEVOI } from '../../lib/pre-analysis-sensitivity.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';
import type { UpstreamGraph, ContestedEdgeInput } from '../../types/engine-v3.js';

interface EVOIRequest {
  graph: UpstreamGraph;
  goal_node_id: string;
  contested_edges: ContestedEdgeInput[];
}

export async function registerEVOIRoute(app: FastifyInstance) {
  app.post('/v1/evoi', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as EVOIRequest;

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

    if (!Array.isArray(body.contested_edges) || body.contested_edges.length === 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'contested_edges[] is required and must be non-empty',
        fields: { field: 'contested_edges' },
      });
    }

    // Validate each contested edge
    for (let i = 0; i < body.contested_edges.length; i++) {
      const ce = body.contested_edges[i];
      if (!ce.edge_id || typeof ce.edge_id !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `contested_edges[${i}].edge_id is required`,
          fields: { field: `contested_edges[${i}].edge_id` },
        });
      }
      if (typeof ce.pass1_strength !== 'number' || !Number.isFinite(ce.pass1_strength) ||
          typeof ce.pass2_strength !== 'number' || !Number.isFinite(ce.pass2_strength)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `contested_edges[${i}] requires finite numeric pass1_strength and pass2_strength`,
          fields: { field: `contested_edges[${i}]` },
        });
      }
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

    // --- Compute EVOI ---
    const result = computeEVOI(normalised.graph, body.goal_node_id, body.contested_edges);

    req.log.info({
      evt: 'evoi',
      id: req.id,
      route: '/v1/evoi',
      contested_edges: body.contested_edges.length,
      top_evoi_impact: result.edges[0]?.evoi_impact ?? 0,
      computation_ms: result.computation_ms,
    }, 'EVOI computed');

    return reply.code(200).send(result);
  });
}
