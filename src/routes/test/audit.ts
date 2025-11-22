/**
 * Test-only audit endpoint
 * Exposes recent audit events for CI verification
 */
import type { FastifyInstance } from 'fastify';
import { getRecentAuditEvents, getAuditStats } from '../../governance/audit-ring.js';

export async function registerAuditTestRoute(app: FastifyInstance) {
  // Only available when TEST_ROUTES=1
  if (process.env.TEST_ROUTES !== '1') {
    return;
  }

  app.get('/__audit__/recent', async (req, reply) => {
    const limit = parseInt(String((req.query as any).limit || '50'), 10);
    const events = getRecentAuditEvents(Math.min(limit, 100));
    const stats = getAuditStats();
    
    return reply.code(200).send({
      schema: 'audit.v1',
      events,
      stats,
      note: 'TEST_ROUTES=1 only. No payloads/PII logged - only hashes and meta.'
    });
  });
}
