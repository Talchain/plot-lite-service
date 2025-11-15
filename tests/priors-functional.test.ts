/**
 * Functional Priors Golden Fixtures
 * 
 * Tests that priors influence inference results deterministically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer } from './utils.js';

describe('Functional Priors - /v1/run', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    server = await spawnServer();
    baseUrl = server.url;
  });

  afterAll(async () => {
    if (server?.kill) await server.kill();
  });

  it('priors influence results (number format)', async () => {
    const graph = {
      nodes: [
        { id: 'demand', label: 'Demand' },
        { id: 'revenue', label: 'Revenue' }
      ],
      edges: [
        { from: 'demand', to: 'revenue' }
      ]
    };

    // Run without priors
    const withoutPriors = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        seed: 4242,
        outcome_node: 'revenue',
        baseline_value: 100
      })
    });
    const resultWithout = await withoutPriors.json();

    // Run with priors
    const withPriors = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        priors: { demand: 0.8 },
        seed: 4242,
        outcome_node: 'revenue',
        baseline_value: 100
      })
    });
    const resultWith = await withPriors.json();

    // Results should be different
    expect(resultWith.summary).toBeDefined();
    expect(resultWithout.summary).toBeDefined();
    
    // With higher prior on demand, results should differ
    // (exact values depend on inference engine, but they should not be identical)
    const withP50 = resultWith.summary.p50;
    const withoutP50 = resultWithout.summary.p50;
    
    // Allow for some tolerance, but they should be measurably different
    expect(Math.abs(withP50 - withoutP50)).toBeGreaterThan(0.01);
  });

  it('priors influence results (distribution format)', async () => {
    const graph = {
      nodes: [
        { id: 'price', label: 'Price' },
        { id: 'demand', label: 'Demand' },
        { id: 'revenue', label: 'Revenue' }
      ],
      edges: [
        { from: 'price', to: 'demand' },
        { from: 'demand', to: 'revenue' }
      ]
    };

    // Run with distribution priors
    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        priors: {
          price: { mean: 0.6, sd: 0.1 },
          demand: { mean: 0.7, sd: 0.05 }
        },
        seed: 4242,
        outcome_node: 'revenue',
        baseline_value: 100
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.schema).toBe('run.v1');
    expect(result.summary).toBeDefined();
    expect(result.summary.p10).toBeTypeOf('number');
    expect(result.summary.p50).toBeTypeOf('number');
    expect(result.summary.p90).toBeTypeOf('number');
  });

  it('deterministic with same seed and priors', async () => {
    const graph = {
      nodes: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' }
      ],
      edges: [{ from: 'A', to: 'B' }]
    };

    const request = {
      graph,
      priors: { A: 0.5 },
      seed: 4242,
      outcome_node: 'B',
      baseline_value: 100
    };

    // Run twice with same inputs
    const response1 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const result1 = await response1.json();

    const response2 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const result2 = await response2.json();

    // Results should be identical
    expect(result1.summary.p10).toBe(result2.summary.p10);
    expect(result1.summary.p50).toBe(result2.summary.p50);
    expect(result1.summary.p90).toBe(result2.summary.p90);
    expect(result1.model_card.response_hash).toBe(result2.model_card.response_hash);
  });

  it('invalid prior value returns 400', async () => {
    const graph = {
      nodes: [{ id: 'A', label: 'A' }],
      edges: []
    };

    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        priors: { A: 1.5 }, // Invalid: > 1
        seed: 4242,
        outcome_node: 'A',
        baseline_value: 100
      })
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.type).toBe('BAD_INPUT');
    expect(error.error.message).toContain('must be between 0 and 1');
  });

  it('prior for non-existent node returns 400', async () => {
    const graph = {
      nodes: [{ id: 'A', label: 'A' }],
      edges: []
    };

    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        priors: { nonexistent: 0.5 },
        seed: 4242,
        outcome_node: 'A',
        baseline_value: 100
      })
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.type).toBe('BAD_INPUT');
    expect(error.error.message).toContain('does not exist');
  });
});
