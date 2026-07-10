/**
 * V2 Routes
 *
 * Option comparison mode endpoints with canonical model.
 */

import type { FastifyInstance } from 'fastify';
import { registerRunV2Route } from './run.js';
import { authGuard, isV2AuthEnabled } from '../../middleware/auth-guard.js';

/**
 * Register all V2 routes.
 */
export async function registerV2Routes(app: FastifyInstance): Promise<void> {
  // /v2 auth gate (ROADMAP 3.4, dark by default — AUTH_V2_ENABLED scope
  // flag; enforcement additionally requires the global AUTH_ENABLED, which
  // authGuard itself checks). Deliberately an onRequest hook, NOT the /v1
  // gate's preHandler: onRequest runs before body parsing/validation, so
  // unauthenticated callers cannot probe schema-validation behaviour.
  // authGuard reads only headers, which are available at onRequest.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url?.startsWith('/v2/')) return;
    // CORS preflight carries no Authorization header by design.
    if (req.method === 'OPTIONS') return;
    if (!isV2AuthEnabled()) return;
    const authorized = await authGuard(req, reply);
    if (!authorized) return reply;
  });

  await registerRunV2Route(app);
}
