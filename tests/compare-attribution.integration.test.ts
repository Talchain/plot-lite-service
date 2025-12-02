/**
 * /v1/compare Change Attribution Integration Tests
 *
 * Tests that the compare endpoint correctly computes and returns
 * change attribution for scenario comparisons.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

describe('/v1/compare change attribution', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register the compare route
    const { registerCompareRoute } = await import(
      '../src/routes/v1/compare.js'
    );
    await registerCompareRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const baselineGraph = {
    nodes: [
      { id: 'marketing', label: 'Marketing Spend', value: 0.8 },
      { id: 'awareness', label: 'Brand Awareness', value: 0.6 },
      { id: 'sales', label: 'Sales Volume', value: 0.7 },
      { id: 'revenue', label: 'Revenue' },
    ],
    edges: [
      { from: 'marketing', to: 'awareness', weight: 0.7 },
      { from: 'awareness', to: 'sales', weight: 0.6 },
      { from: 'sales', to: 'revenue', weight: 0.8 },
    ],
  };

  it('returns schema compare.v1', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Baseline' },
          { graph: baselineGraph, label: 'Same as Baseline' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe('compare.v1');
  });

  it('includes change_attribution for non-baseline options', async () => {
    const modifiedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 }, // Increased
        { from: 'awareness', to: 'sales', weight: 0.6 },
        { from: 'sales', to: 'revenue', weight: 0.8 },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Baseline' },
          { graph: modifiedGraph, label: 'Increased Marketing Impact' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Baseline should NOT have change_attribution
    expect(body.options[0].change_attribution).toBeUndefined();

    // Non-baseline SHOULD have change_attribution
    expect(body.options[1].change_attribution).toBeDefined();
    expect(body.options[1].change_attribution).toHaveProperty('outcome_delta');
    expect(body.options[1].change_attribution).toHaveProperty('primary_drivers');
    expect(body.options[1].change_attribution).toHaveProperty('summary');
  });

  it('primary_drivers have required fields', async () => {
    const modifiedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
        { from: 'sales', to: 'revenue', weight: 0.8 },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Baseline' },
          { graph: modifiedGraph, label: 'Modified' },
        ],
      },
    });

    const body = JSON.parse(response.body);
    const attribution = body.options[1].change_attribution;

    if (attribution.primary_drivers.length > 0) {
      const driver = attribution.primary_drivers[0];
      expect(driver).toHaveProperty('change_type');
      expect(driver).toHaveProperty('description');
      expect(driver).toHaveProperty('contribution_to_delta');
      expect(driver).toHaveProperty('contribution_pct');
      expect(driver).toHaveProperty('affected_nodes');
      expect(Array.isArray(driver.affected_nodes)).toBe(true);
    }
  });

  it('affected_nodes have id and label', async () => {
    const modifiedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
        { from: 'sales', to: 'revenue', weight: 0.8 },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Baseline' },
          { graph: modifiedGraph, label: 'Modified' },
        ],
      },
    });

    const body = JSON.parse(response.body);
    const attribution = body.options[1].change_attribution;

    if (attribution.primary_drivers.length > 0) {
      const driver = attribution.primary_drivers[0];
      for (const node of driver.affected_nodes) {
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('label');
        expect(typeof node.id).toBe('string');
        expect(typeof node.label).toBe('string');
      }
    }
  });

  it('returns top_drivers with node_label', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Option A' },
          { graph: baselineGraph, label: 'Option B' },
        ],
      },
    });

    const body = JSON.parse(response.body);

    for (const option of body.options) {
      expect(option.top_drivers).toBeDefined();
      expect(Array.isArray(option.top_drivers)).toBe(true);

      if (option.top_drivers.length > 0) {
        const driver = option.top_drivers[0];
        expect(driver).toHaveProperty('node_id');
        expect(driver).toHaveProperty('node_label');
        expect(driver).toHaveProperty('sign');
        expect(driver).toHaveProperty('contribution');
      }
    }
  });

  it('calculates delta from baseline correctly', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Baseline' },
          { graph: baselineGraph, label: 'Same' },
        ],
      },
    });

    const body = JSON.parse(response.body);

    // Baseline delta should be zero
    expect(body.options[0].delta).toEqual({ p10: 0, p50: 0, p90: 0 });
  });

  it('supports custom outcome_node', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        outcome_node: 'sales',
        graphs: [
          { graph: baselineGraph, label: 'A' },
          { graph: baselineGraph, label: 'B' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('supports custom baseline_value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        baseline_value: 1000,
        graphs: [
          { graph: baselineGraph, label: 'A' },
          { graph: baselineGraph, label: 'B' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('validates minimum 2 graphs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        graphs: [{ graph: baselineGraph, label: 'Only One' }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('validates maximum 5 graphs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        graphs: Array(6).fill({ graph: baselineGraph, label: 'Option' }),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('handles edge removal attribution', async () => {
    const reducedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.7 },
        // Removed: awareness -> sales
        { from: 'sales', to: 'revenue', weight: 0.8 },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Full Graph' },
          { graph: reducedGraph, label: 'Reduced Graph' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const attribution = body.options[1].change_attribution;

    expect(attribution).toBeDefined();

    // Should have an edge_removed driver
    const removalDriver = attribution.primary_drivers.find(
      (d: any) => d.change_type === 'edge_removed'
    );
    expect(removalDriver).toBeDefined();
  });

  it('handles edge addition attribution', async () => {
    const expandedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        ...baselineGraph.edges,
        { from: 'marketing', to: 'sales', weight: 0.5 }, // New edge
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/compare',
      payload: {
        seed: 42,
        graphs: [
          { graph: baselineGraph, label: 'Original' },
          { graph: expandedGraph, label: 'With New Edge' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const attribution = body.options[1].change_attribution;

    expect(attribution).toBeDefined();

    // Should have an edge_added driver
    const additionDriver = attribution.primary_drivers.find(
      (d: any) => d.change_type === 'edge_added'
    );
    expect(additionDriver).toBeDefined();
  });

  it('is deterministic with same seed', async () => {
    const modifiedGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
        { from: 'sales', to: 'revenue', weight: 0.8 },
      ],
    };

    const payload = {
      seed: 12345,
      graphs: [
        { graph: baselineGraph, label: 'Baseline' },
        { graph: modifiedGraph, label: 'Modified' },
      ],
    };

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/compare', payload }),
      app.inject({ method: 'POST', url: '/v1/compare', payload }),
      app.inject({ method: 'POST', url: '/v1/compare', payload }),
    ]);

    const bodies = responses.map((r) => JSON.parse(r.body));

    // All responses should be identical
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});
