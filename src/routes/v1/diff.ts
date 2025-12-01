/**
 * POST /v1/diff - Graph diff helper for comparison views
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DiffGraph, GraphDiffResult } from '../../util/graph-diff.js';
import { computeGraphDiff } from '../../util/graph-diff.js';

interface DiffRequestBody {
  before: DiffGraph;
  after: DiffGraph;
}

export async function registerDiffRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');

  app.post(
    '/v1/diff',
    {
      bodyLimit: 64 * 1024,
      preHandler: [createValidator('diff')],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req as any).body as DiffRequestBody | undefined;

      const before: DiffGraph = body?.before ?? { nodes: [], edges: [] };
      const after: DiffGraph = body?.after ?? { nodes: [], edges: [] };

      const diff: GraphDiffResult = computeGraphDiff(before, after);

      const graphsSummary = {
        before: {
          nodes: Array.isArray(before.nodes) ? before.nodes.length : 0,
          edges: Array.isArray(before.edges) ? before.edges.length : 0,
        },
        after: {
          nodes: Array.isArray(after.nodes) ? after.nodes.length : 0,
          edges: Array.isArray(after.edges) ? after.edges.length : 0,
        },
      };

      return reply.code(200).send({
        schema: 'diff.v1',
        graphs: graphsSummary,
        diff,
      });
    },
  );
}
