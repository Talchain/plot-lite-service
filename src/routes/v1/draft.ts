/**
 * POST /v1/draft - Text → Model drafting with immediate critique
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateStarterBoards } from '../../drafting/text-to-model.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';

export interface DraftRequest {
  description: string;
  domain?: 'pricing' | 'product' | 'marketing';
}

export async function registerDraftRoute(app: FastifyInstance) {
  app.post('/v1/draft', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req as any).body as DraftRequest;

    if (!body.description) {
      return reply.code(400).send({
        error: 'BAD_INPUT',
        message: 'Field "description" is required',
        hint: 'Provide a short text description of your model',
      });
    }

    const { description, domain } = body;

    // Validate description length
    if (description.length > 500) {
      return reply.code(400).send({
        error: 'BAD_INPUT',
        message: 'Description too long (max 500 characters)',
      });
    }

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

    return {
      schema: 'draft.v1',
      description,
      domain: domain || 'auto-detected',
      boards,
      model_card,
      usage_hint: 'Select a starter board, refine the graph, then run /v1/run or /v1/critique',
    };
  });
}
