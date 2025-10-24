import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable, stableStringify, normaliseReport } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';
import { createHash } from 'node:crypto';

describe('Manual hash', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('compute manually', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    const runBody: any = run.json();
    
    console.log('\n=== Manual computation ===');
    const norm = normaliseReport(runBody);
    const canon = stableStringify(norm);
    const hash1 = createHash('sha256').update(canon, 'utf8').digest('hex');
    const hash2 = sha256Stable(runBody);
    
    console.log('Hash via manual:', hash1);
    console.log('Hash via sha256Stable:', hash2);
    console.log('Match?', hash1 === hash2);
    
    console.log('\n=== Response hash in body ===');
    console.log('response_hash:', runBody.model_card.response_hash);
  });
});
