/**
 * POST /v1/critique - Model critique with fix suggestions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode, getDemoSeed } from '../../middleware/demo-mode.js';
import { getDemoCritiqueResponse } from '../../fixtures/demo-payloads.js';
import { stampResponseHash } from '../../util/canonical-json.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';
import { buildCritique } from '../../trust/critique-builder.js';
import { checkIdentifiability } from '../../trust/identifiability.js';
import type { Graph } from '../../trust/types.js';
import { getActiveBackend } from '../../config/backend.js';

export interface CritiqueRequest {
  graph: Graph;
  assumptions?: string[];
  treatment_node?: string;
  outcome_node?: string;
  seed?: number;
}

export async function registerCritiqueRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/critique', {
    bodyLimit: 64 * 1024,
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Demo mode short-circuit (before Ajv)
        if (isDemoMode(req)) {
          const demo_seed = getDemoSeed(req);
          const payload = getDemoCritiqueResponse(demo_seed);
          return reply.code(200).type('application/json').send(payload);
        }
      },
      createValidator('critique'),
    ],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // (demo handled in preHandler)

    const body = (req as any).body as CritiqueRequest;

    const {
      graph,
      assumptions = [],
      treatment_node = graph.nodes[0]?.id,
      outcome_node = graph.nodes[graph.nodes.length - 1]?.id,
      seed = 0,
    } = body;

    // Identifiability check
    const identifiability = checkIdentifiability({
      graph,
      treatment_node,
      outcome_node,
    });

    // Get active backend
    const backend = getActiveBackend();

    // Model card
    const model_card = buildModelCard({
      seed,
      assumptions: assumptions.length > 0 ? assumptions : undefined,
      feature_flags: getActiveFeatureFlags(),
      backend,
    });

    // Build critique
    const critique = buildCritique({
      graph,
      assumptions,
      identifiable: identifiability.identifiable,
      node_limit: 12,
    });

    // Count auto-fixable issues
    const auto_fixable_count = critique.filter(c => c.auto_fixable).length;

    const response = {
      schema: 'critique.v1',
      graph,
      critique,
      model_card,
      identifiability: identifiability.summary,
      summary: {
        total_issues: critique.length,
        blockers: critique.filter(c => c.severity === 'BLOCKER').length,
        improvements: critique.filter(c => c.severity === 'IMPROVEMENT').length,
        observations: critique.filter(c => c.severity === 'OBSERVATION').length,
        auto_fixable: auto_fixable_count,
      },
    };
    
    // Set X-Olumi-Backend header
    reply.header('X-Olumi-Backend', backend);
    
    return stampResponseHash(response);
  });
}
