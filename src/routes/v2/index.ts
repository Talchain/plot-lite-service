/**
 * V2 Routes
 *
 * Option comparison mode endpoints with canonical model.
 */

import type { FastifyInstance } from 'fastify';
import { registerRunV2Route } from './run.js';

/**
 * Register all V2 routes.
 */
export async function registerV2Routes(app: FastifyInstance): Promise<void> {
  await registerRunV2Route(app);
}
