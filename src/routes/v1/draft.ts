/**
 * POST /v1/draft - Text → Model drafting with immediate critique
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode, getDemoSeed } from '../../middleware/demo-mode.js';
import { getDemoRunResponse } from '../../fixtures/demo-payloads.js';
import { stampResponseHash } from '../../util/canonical-json.js';
import { generateStarterBoards } from '../../drafting/text-to-model.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';

export interface DraftRequest {
  description: string;
  domain?: 'pricing' | 'product' | 'marketing';
}

export async function registerDraftRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');

  app.post('/v1/draft', {
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Demo mode short-circuit (before Ajv)
        if (isDemoMode(req)) {
          const demo_seed = getDemoSeed(req);
          const boards = generateStarterBoards({ description: 'Demo Draft', domain: 'pricing' });
          const model_card = buildModelCard({
            seed: demo_seed,
            assumptions: ['Draft generated from demo mode', 'Template-based starter model'],
            feature_flags: getActiveFeatureFlags(),
          });
          const doc = stampResponseHash({
            schema: 'draft.v1',
            description: 'Demo Draft',
            domain: 'pricing',
            boards,
            model_card,
            usage_hint: 'Select a starter board, refine the graph, then run /v1/run or /v1/critique',
          } as any);
          return reply.code(200).type('application/json').send(doc);
        }
      },
      createValidator('draft'),
    ],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req as any).body as DraftRequest;

    const { description, domain } = body;

    // Generate starter boards
    const boards = generateStarterBoards({
      description,
      domain,
    });

    // Model card
    const model_card = buildModelCard({
      seed: 0,
      assumptions: ['Draft generated from text description', 'Template-based starter model'],
      feature_flags: getActiveFeatureFlags(),
    });

    const response = {
      schema: 'draft.v1',
      description,
      domain: domain || 'auto-detected',
      boards,
      model_card,
      usage_hint: 'Select a starter board, refine the graph, then run /v1/run or /v1/critique',
    } as any;
    return stampResponseHash(response);
  });
}
