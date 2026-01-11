/**
 * Tests for node kind normalization
 * P0: Ensures responses never contain invalid kind values
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { normalizeNode, normalizeGraphWithWarnings } from '../src/util/normalize.js';

describe('normalizeNode', () => {
  it('maps valid type to kind', () => {
    const { node, warning } = normalizeNode({ id: 'n1', type: 'goal' });
    expect(node.kind).toBe('goal');
    expect(warning).toBeUndefined();
  });

  it('does not set kind for invalid type, generates warning', () => {
    const { node, warning } = normalizeNode({ id: 'n1', type: 'segment' });
    expect(node.kind).toBeUndefined();
    expect(warning).toContain('Invalid node kind');
    expect(warning).toContain('segment');
    expect(warning).toContain('goal, decision, option, outcome, risk, action');
  });

  it('removes invalid kind when directly provided', () => {
    const { node, warning } = normalizeNode({ id: 'n1', kind: 'invalid_kind' });
    expect(node.kind).toBeUndefined();
    expect(warning).toContain('Invalid node kind');
  });

  it('keeps valid kind when directly provided', () => {
    const { node, warning } = normalizeNode({ id: 'n1', kind: 'decision' });
    expect(node.kind).toBe('decision');
    expect(warning).toBeUndefined();
  });

  it('preserves type field for backward compatibility', () => {
    const { node } = normalizeNode({ id: 'n1', type: 'goal' });
    expect(node.type).toBe('goal');
    expect(node.kind).toBe('goal');
  });
});

describe('normalizeGraphWithWarnings', () => {
  it('collects warnings for all invalid kinds', () => {
    const { graph, warnings } = normalizeGraphWithWarnings({
      nodes: [
        { id: 'n1', type: 'segment' },
        { id: 'n2', kind: 'custom_node' },
        { id: 'n3', kind: 'goal' },
      ],
      edges: [],
    });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("'segment'");
    expect(warnings[0]).toContain("node 'n1'");
    expect(warnings[1]).toContain("'custom_node'");
    expect(warnings[1]).toContain("node 'n2'");

    // Valid kind is preserved
    expect(graph.nodes[2].kind).toBe('goal');
    // Invalid kinds are removed
    expect(graph.nodes[0].kind).toBeUndefined();
    expect(graph.nodes[1].kind).toBeUndefined();
  });
});

describe('POST /v1/run - invalid kind handling', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { registerRunRoute } = await import('../src/routes/v1/run.js');
    await registerRunRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 for graph with invalid node type, no kind in response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        graph: {
          nodes: [
            { id: 'A', label: 'Input', type: 'segment' },
            { id: 'B', label: 'Output' },
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);

    // Node with invalid type should not have kind in response
    const nodeA = body.graph.nodes.find((n: any) => n.id === 'A');
    expect(nodeA.kind).toBeUndefined();

    // Critique should contain warning about invalid kind
    const kindWarning = body.critique.find((c: any) =>
      c.message.includes('Invalid node kind') && c.message.includes('segment')
    );
    expect(kindWarning).toBeDefined();
    expect(kindWarning.severity).toBe('OBSERVATION');
    expect(kindWarning.source).toBe('engine');
  });

  it('preserves valid kinds in response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        graph: {
          nodes: [
            { id: 'A', label: 'Decision', kind: 'decision' },
            { id: 'B', label: 'Outcome', kind: 'outcome', value: 100 },
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);

    expect(body.graph.nodes[0].kind).toBe('decision');
    expect(body.graph.nodes[1].kind).toBe('outcome');
  });
});
