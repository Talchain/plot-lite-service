import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable, stableStringify, normaliseReport, stampResponseHash } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

describe('Selfcheck trace', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('trace hash computation', async () => {
    // Simulate what self-check does
    const mockReport = {
      schema: 'run.v1',
      meta: { seed: 42, commit: 'dev', version: '1.0.0' },
      model_card: { seed: 42 },
      confidence: { level: 'HIGH', score: 0.9 },
      critique: [{ severity: 'LOW', message: 'test' }],
    } as any;
    
    console.log('\n=== Step 1: stampResponseHash ===');
    const stamped = stampResponseHash(mockReport);
    console.log('response_hash added:', stamped.model_card.response_hash);
    
    console.log('\n=== Step 2: sha256Stable(stamped) ===');
    const hash2 = sha256Stable(stamped);
    console.log('Hash after stamping:', hash2);
    
    console.log('\n=== Step 3: Normalize stamped ===');
    const norm = normaliseReport(stamped);
    console.log('Has response_hash after norm?', 'response_hash' in (norm as any).model_card);
    
    console.log('\n=== Comparison ===');
    console.log('Hash from stampResponseHash:', stamped.model_card.response_hash);
    console.log('Hash from sha256Stable(stamped):', hash2);
    console.log('Match?', stamped.model_card.response_hash === hash2);
  });
});
