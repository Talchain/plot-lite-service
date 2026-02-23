/**
 * Integration tests: FactObjectV1 in run_bundle response.
 *
 * Verifies:
 * - facts field present when ENABLE_FACTS_ASSEMBLY=1
 * - facts field absent when ENABLE_FACTS_ASSEMBLY=0
 * - FactsEnvelope structure and content
 * - Backward compatibility: existing fields unchanged
 * - Contract: facts validates against expected shape
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

const BASIC_PAYLOAD = {
  base_graph: {
    nodes: [
      { id: 'demand', label: 'Demand', value: 0.7 },
      { id: 'price', label: 'Price', value: 0.5 },
      { id: 'revenue', label: 'Revenue', value: 0.6 },
    ],
    edges: [
      { from: 'demand', to: 'revenue', weight: 0.8 },
      { from: 'price', to: 'revenue', weight: 0.6 },
    ],
  },
  deltas: [
    { label: 'Low Price', nodes: [{ id: 'price', value: 0.3 }] },
    { label: 'High Price', nodes: [{ id: 'price', value: 0.8 }] },
  ],
  seed: 4242,
};

describe('run_bundle facts integration (ENABLE_FACTS_ASSEMBLY=1)', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({ env: { ENABLE_FACTS_ASSEMBLY: '1' } });
  });
  afterAll(async () => { await server.kill(); });

  it('response includes facts envelope', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.facts).toBeDefined();
    expect(data.facts.facts_schema_version).toBe(1);
    expect(data.facts.analysis_status).toBe('computed');
    expect(Array.isArray(data.facts.facts)).toBe(true);
  });

  it('facts contain probability facts for each scenario', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    const probFacts = data.facts.facts.filter((f: any) => f.fact_type === 'probability');
    expect(probFacts.length).toBe(2); // Two scenarios

    // Verify structure of each probability fact
    for (const fact of probFacts) {
      expect(fact.fact_id).toMatch(/^[0-9a-f]{16}$/);
      expect(fact.fact_key.type).toBe('probability');
      expect(fact.data.type).toBe('probability');
      expect(typeof fact.data.p10).toBe('number');
      expect(typeof fact.data.p50).toBe('number');
      expect(typeof fact.data.p90).toBe('number');
      expect(typeof fact.data.mean).toBe('number');
      expect(fact.lineage).toBeDefined();
      expect(fact.lineage.graph_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(fact.lineage.seed).toBe(4242);
      expect(fact.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('content_hashes are deterministic across identical requests', async () => {
    const body = JSON.stringify(BASIC_PAYLOAD);
    const [res1, res2] = await Promise.all([
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);
    const data1 = await res1.json();
    const data2 = await res2.json();

    // Same payload → same content_hashes (derived from data only, not lineage)
    const hashes1 = data1.facts.facts.map((f: any) => f.content_hash).sort();
    const hashes2 = data2.facts.facts.map((f: any) => f.content_hash).sort();
    expect(hashes1).toEqual(hashes2);

    // Same fact_key structure (same option_ids / types)
    const keys1 = data1.facts.facts.map((f: any) => JSON.stringify(f.fact_key)).sort();
    const keys2 = data2.facts.facts.map((f: any) => JSON.stringify(f.fact_key)).sort();
    expect(keys1).toEqual(keys2);
  });

  it('existing response fields unchanged (backward compatible)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    // Core fields unchanged
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toHaveLength(2);
    expect(data.model_card).toBeDefined();
    expect(data.meta).toBeDefined();
    expect(data.meta.total_scenarios).toBe(2);
  });

  it('lineage uses request_id (not isl_request_id) for run_bundle', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    const lineage = data.facts.facts[0].lineage;
    expect(lineage.request_id).toBeDefined();
    expect(lineage.isl_request_id).toBeUndefined();
  });
});

describe('run_bundle facts: response_hash stability across flag toggle', () => {
  let serverOn: ServerHandle;
  let serverOff: ServerHandle;

  beforeAll(async () => {
    [serverOn, serverOff] = await Promise.all([
      spawnServer({ env: { ENABLE_FACTS_ASSEMBLY: '1' } }),
      spawnServer({ env: { ENABLE_FACTS_ASSEMBLY: '0' } }),
    ]);
  });
  afterAll(async () => {
    await Promise.all([serverOn.kill(), serverOff.kill()]);
  });

  it('response_hash is identical whether ENABLE_FACTS_ASSEMBLY is on or off', async () => {
    const body = JSON.stringify(BASIC_PAYLOAD);
    const [resOn, resOff] = await Promise.all([
      fetch(`${serverOn.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${serverOff.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);
    const dataOn = await resOn.json();
    const dataOff = await resOff.json();

    expect(dataOn.facts).toBeDefined();
    expect(dataOff.facts).toBeUndefined();
    expect(dataOn.model_card.response_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(dataOn.model_card.response_hash).toBe(dataOff.model_card.response_hash);
  });
});

describe('run_bundle facts integration (ENABLE_FACTS_ASSEMBLY=0)', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({ env: { ENABLE_FACTS_ASSEMBLY: '0' } });
  });
  afterAll(async () => { await server.kill(); });

  it('response does NOT include facts when disabled', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.facts).toBeUndefined();
    // Existing fields still present
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toHaveLength(2);
  });
});
