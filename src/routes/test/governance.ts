import type { FastifyInstance } from 'fastify';
import { getAuditStats } from '../../governance/audit-ring.js';

const ENGINE_VERSION = '1.3.0';
const CONTRACT_VERSION = 'v1';
const MODEL_VERSION = 'plot-lite-2024';

export async function registerGovernanceRoute(app: FastifyInstance) {
  if (process.env.TEST_ROUTES !== '1') {
    return;
  }

  app.get('/__governance__/versions', async (req, reply) => {
    const stats = getAuditStats();
    
    return reply.code(200).send({
      schema: 'governance.v1',
      versions: {
        engine_version: ENGINE_VERSION,
        contract_version: CONTRACT_VERSION,
        model_version: MODEL_VERSION
      },
      feature_flags: {
        SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE || null,
        STREAM_PARITY_ENABLE: process.env.STREAM_PARITY_ENABLE || null,
        TEST_ROUTES: process.env.TEST_ROUTES || null
      },
      audit: {
        entries: stats.total_entries,
        max_entries: stats.max_entries
      }
    });
  });
}

export { ENGINE_VERSION, CONTRACT_VERSION, MODEL_VERSION };
