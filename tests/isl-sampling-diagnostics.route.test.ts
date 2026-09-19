/**
 * Actual enhanced-ISL producer bytes through the complete serialized PLoT route.
 * The service transport is stubbed, as in the existing conditional-winner route
 * fixture test; response fields are never reconstructed for the positive arm.
 * Fixture provenance/producer commands are banked beside the exact bytes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Fixture = { request: any; response: any; status: number; producer_head: string };
const fixtures = Object.fromEntries(
  ['frequent_ties', 'rare_ties', 'no_ties', 'old_producer'].map((name) => [
    name, JSON.parse(readFileSync(new URL(`./fixtures/isl-sampling-transport-20260831/${name}.json`, import.meta.url), 'utf8')) as Fixture,
  ]),
);
let fixture = fixtures.frequent_ties;
let responseBytes = fixture.response;
let actualEndpoint: string | undefined;
let actualRequest: any;

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Fixture', reasoning: 'Fixture' }, source: 'isl' };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust', robustness_score: 0.8, latency_ms: 0, source: 'unavailable' };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(endpoint: string, body: unknown) {
    actualEndpoint = endpoint;
    actualRequest = structuredClone(body);
    return { data: structuredClone(responseBytes) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

function requestForPlot(request: any) {
  return {
    graph: request.graph,
    options: request.options,
    goal_node_id: request.goal_node_id,
    n_samples: request.n_samples,
    seed: String(request.seed),
  };
}

describe('enhanced ISL sampling measurements survive the actual /v2/run route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => { await app.close(); });

  async function run(name: string, change?: (body: any) => void) {
    fixture = fixtures[name];
    responseBytes = structuredClone(fixture.response);
    change?.(responseBytes);
    actualEndpoint = undefined;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: requestForPlot(fixture.request) });
    expect(res.statusCode).toBe(200);
    expect(actualEndpoint).toBe('/api/v1/robustness/analyze/v2');
    const body = res.json();
    expect(['computed', 'partial']).toContain(body.analysis_status);
    return body;
  }

  function scientificInput() {
    const input = structuredClone(actualRequest);
    // The route creates a fresh tracing ID per call; all scientific fields
    // remain in the comparison, including graph, options, seed and sample count.
    delete input.request_id;
    return input;
  }

  it('consumes immutable real producer fixtures with matching byte hashes', () => {
    const base = new URL('./fixtures/isl-sampling-transport-20260831/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
    expect(manifest.uncommitted_source).not.toBe(true);
    expect(manifest.producer_head).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.producer_head).not.toBe('28fe0c950f6ca5737f4555c863353d37b734dddf');
    for (const [name, hash] of Object.entries(manifest.fixture_sha256)) {
      expect(createHash('sha256').update(readFileSync(new URL(name, base))).digest('hex'), name).toBe(hash);
    }
    for (const name of ['frequent_ties', 'rare_ties', 'no_ties']) {
      expect(fixtures[name].producer_head).toBe(manifest.producer_head);
      expect(fixtures[name].status).toBe(200);
    }
    expect(fixtures.old_producer.producer_head).toBe('28fe0c950f6ca5737f4555c863353d37b734dddf');
  });

  it.each([
    ['frequent_ties', 0.91, 0.09],
    ['rare_ties', 0.07, 0.93],
    ['no_ties', 0, 1],
  ])('real producer %s retains its exact measurements, including zero', async (name, tie, edge) => {
    const producer = fixtures[name as string].response;
    expect(producer.tie_rate).toBe(tie);
    expect(producer.edge_existence_rates).toEqual({ 'input->goal': edge });
    const body = await run(name as string);
    expect(body.tie_rate).toBe(producer.tie_rate);
    expect(body.edge_existence_rates).toEqual(producer.edge_existence_rates);
  });

  it('old producer absence stays unavailable, not zero or a stable verdict', async () => {
    expect(fixtures.old_producer.response).not.toHaveProperty('tie_rate');
    expect(fixtures.old_producer.response).not.toHaveProperty('edge_existence_rates');
    const body = await run('old_producer');
    expect(body).not.toHaveProperty('tie_rate');
    expect(body).not.toHaveProperty('edge_existence_rates');
    expect(body.inference_warnings.some((w: any) => w.code === 'ISL_SAMPLING_DIAGNOSTICS_INVALID')).toBe(false);
  });

  it('does not substitute a legacy/internal metadata location for an omitted enhanced field', async () => {
    const body = await run('frequent_ties', (producer) => {
      producer._metadata = { tie_rate: producer.tie_rate, edge_existence_rates: producer.edge_existence_rates };
      delete producer.tie_rate;
      delete producer.edge_existence_rates;
    });
    expect(body).not.toHaveProperty('tie_rate');
    expect(body).not.toHaveProperty('edge_existence_rates');
  });

  it('refuses malformed optional measurements without publishing a partial edge map', async () => {
    const body = await run('frequent_ties', (producer) => {
      producer.tie_rate = '0.91';
      producer.edge_existence_rates['invalid->goal'] = 1.5;
    });
    expect(body).not.toHaveProperty('tie_rate');
    expect(body).not.toHaveProperty('edge_existence_rates');
    expect(body.inference_warnings).toContainEqual({
      code: 'ISL_SAMPLING_DIAGNOSTICS_INVALID',
      message: 'ISL sampling measurements unavailable: invalid tie_rate, edge_existence_rates',
      severity: 'warning',
    });
  });

  it('unrelated metadata cannot change carriage, scientific input, outcomes or the request hash', async () => {
    const baseline = await run('rare_ties');
    const input = scientificInput();
    const changed = await run('rare_ties', (producer) => { producer.timestamp = '2030-01-01T00:00:00Z'; });
    expect(scientificInput()).toEqual(input);
    expect(changed.tie_rate).toBe(baseline.tie_rate);
    expect(changed.edge_existence_rates).toEqual(baseline.edge_existence_rates);
    expect(changed.option_comparison).toEqual(baseline.option_comparison);
    expect(changed.response_hash).toBe(baseline.response_hash);
    expect(changed._meta.response_content_hash).toBe(baseline._meta.response_content_hash);
  });

  it('omitting measurements leaves scientific input/outcomes unchanged but changes the content hash', async () => {
    const baseline = await run('rare_ties');
    const input = scientificInput();
    const absent = await run('rare_ties', (producer) => { delete producer.tie_rate; delete producer.edge_existence_rates; });
    expect(scientificInput()).toEqual(input);
    expect(absent.option_comparison).toEqual(baseline.option_comparison);
    expect(absent.response_hash).toBe(baseline.response_hash);
    expect(absent._meta.response_content_hash).not.toBe(baseline._meta.response_content_hash);
  });
});
