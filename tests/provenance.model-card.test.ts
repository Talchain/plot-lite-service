import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

/**
 * Provenance summary on model_card (PROVENANCE_ENABLE=1)
 */

describe('Provenance summary on model_card', () => {
  let app: FastifyInstance;
  const prevProv = process.env.PROVENANCE_ENABLE;

  beforeAll(async () => {
    process.env.PROVENANCE_ENABLE = '1';
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app.close();
    if (prevProv === undefined) {
      delete process.env.PROVENANCE_ENABLE;
    } else {
      process.env.PROVENANCE_ENABLE = prevProv;
    }
  });

  it('attaches provenance_summary with sources and counts when flag is enabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1, belief: 0.8, provenance: 'template' },
            { from: 'B', to: 'A', weight: 1, belief: 0.9, provenance: 'Study 2023' },
          ],
        },
        outcome_node: 'B',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.model_card).toBeDefined();
    const summary = body.model_card.provenance_summary;
    expect(summary).toBeDefined();

    // Totals reflect all edges
    expect(summary.edges_total).toBe(2);

    // Only non-assumption provenance counts towards evidence-backed edges
    expect(summary.edges_with_provenance).toBe(1);

    // Sources list excludes 'template' and includes only external evidence labels
    expect(summary.sources).toEqual(['Study 2023']);
    expect(summary.source_count).toBe(1);
  });
});
