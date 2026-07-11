/**
 * Identifiability thread-through tests (CEE #427 follow-up)
 *
 * CEE's key-insight handler (post-#427) only uses confident causal language
 * when the request carries an identifiability block; PLoT's proxy previously
 * sent none, so CEE hedged on every request. These tests pin:
 *
 *  - the proxy request carries PLoT's computed identifiability (the same
 *    checkIdentifiability computation /v1/run uses), in the exact shape CEE's
 *    IdentifiabilitySchema accepts (olumi-assistants-service src/schemas/cee.ts);
 *  - a non-identifiable graph sends identifiable:false verbatim — never
 *    defaulted to true (CEE's fail-honest doctrine);
 *  - when the computation is unavailable, the field is omitted and both the
 *    outbound CEE request and the caller-facing response are byte-identical
 *    to the pre-thread baselines captured from staging cd369634d
 *    (tests/fixtures/key-insight-identifiability/ — see capture-baselines.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const identState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('../src/trust/identifiability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/trust/identifiability.js')>();
  return {
    ...actual,
    checkIdentifiability: (inputs: Parameters<typeof actual.checkIdentifiability>[0]) => {
      if (identState.shouldThrow) {
        throw new Error('identifiability computation unavailable (test)');
      }
      return actual.checkIdentifiability(inputs);
    },
  };
});

import { registerKeyInsightRoute } from '../src/routes/v1/key-insight.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'key-insight-identifiability'
);

/**
 * Identical to the payload in capture-baselines.ts — the byte-identity pins
 * only hold for this exact payload. Confounder-free chain: a -> b -> c.
 */
const PIN_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'a', label: 'Ship weekly releases', kind: 'option' },
      { id: 'b', label: 'User trust', kind: 'factor' },
      { id: 'c', label: 'Revenue', kind: 'outcome', value: 100 },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 0.6 },
      { from: 'b', to: 'c', weight: 0.5 },
    ],
  },
  seed: 4242,
  outcome_node: 'c',
};

/** Treatment (nodes[0]) has no causal path to the outcome -> not identifiable. */
const NO_PATH_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'iso', label: 'Disconnected lever', kind: 'option' },
      { id: 'b', label: 'Marketing push', kind: 'option' },
      { id: 'out', label: 'Revenue', kind: 'outcome', value: 100 },
    ],
    edges: [{ from: 'b', to: 'out', weight: 0.5 }],
  },
  seed: 4242,
  outcome_node: 'out',
};

/** Confounder z -> a and z -> c alongside a -> c: backdoor adjustment on z. */
const BACKDOOR_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'a', label: 'Raise prices', kind: 'option' },
      { id: 'z', label: 'Brand strength', kind: 'factor' },
      { id: 'c', label: 'Revenue', kind: 'outcome', value: 100 },
    ],
    edges: [
      { from: 'z', to: 'a', weight: 0.4 },
      { from: 'z', to: 'c', weight: 0.4 },
      { from: 'a', to: 'c', weight: 0.6 },
    ],
  },
  seed: 4242,
  outcome_node: 'c',
};

const ENV_KEYS = [
  'CEE_KEY_INSIGHT_ENABLE',
  'CEE_ORCHESTRATOR_ENABLED',
  'CEE_BASE_URL',
  'CEE_API_KEY',
  'IDENT_DSEP_ENABLE',
  'IDENT_DAG_VALIDATE',
] as const;

describe('key-insight identifiability thread-through (#427 follow-up)', () => {
  let app: FastifyInstance;
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerKeyInsightRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    identState.shouldThrow = false;
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CEE_KEY_INSIGHT_ENABLE = '1';
    process.env.CEE_BASE_URL = 'http://cee.test';
    process.env.CEE_API_KEY = 'test-key';
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ insight: 'stub insight', confidence: 'high' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    identState.shouldThrow = false;
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  async function captureCeeRequestBody(payload: unknown): Promise<Record<string, any>> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/assist/key-insight',
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0];
    return JSON.parse(options.body);
  }

  it('threads PLoT-computed identifiability into the CEE proxy request (confounder-free chain)', async () => {
    const body = await captureCeeRequestBody(PIN_PAYLOAD);

    expect(body.identifiability).toEqual({
      identifiable: true,
      method: null,
      adjustment_set: [],
      explanation:
        'Identifiable: Yes. No confounders detected - direct causal effect estimable.',
    });
  });

  it('sends identifiable:false verbatim for a non-identifiable graph — never default-true', async () => {
    const body = await captureCeeRequestBody(NO_PATH_PAYLOAD);

    expect(body.identifiability).toBeDefined();
    expect(body.identifiability.identifiable).toBe(false);
    expect(body.identifiability.method).toBeNull();
    expect(body.identifiability.explanation).toContain('No causal path');
  });

  it('names the backdoor criterion and adjustment set when confounding requires adjustment', async () => {
    const body = await captureCeeRequestBody(BACKDOOR_PAYLOAD);

    expect(body.identifiability).toEqual({
      identifiable: true,
      method: 'backdoor',
      adjustment_set: ['z'],
      explanation: 'Identifiable: Yes. Adjust for: Brand strength',
    });
  });

  it('omits identifiability and keeps the CEE request byte-identical to the pre-thread baseline when computation is unavailable', async () => {
    const baselineRaw = readFileSync(join(FIXTURE_DIR, 'baseline-cee-request.json'), 'utf8');
    // The baseline (captured pre-thread at staging cd369634d) itself proves
    // today's proxy request carried no identifiability field.
    expect(JSON.parse(baselineRaw).identifiability).toBeUndefined();

    identState.shouldThrow = true;
    const body = await captureCeeRequestBody(PIN_PAYLOAD);

    expect('identifiability' in body).toBe(false);
    delete body.plot_request_id; // per-request correlation id, not a stable byte
    expect(JSON.stringify(body)).toBe(baselineRaw);
  });

  it('keeps the caller-facing response byte-identical to the pre-thread baseline (CEE disabled)', async () => {
    const baselineRaw = readFileSync(join(FIXTURE_DIR, 'baseline-response.json'), 'utf8');

    delete process.env.CEE_KEY_INSIGHT_ENABLE;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/assist/key-insight',
      payload: PIN_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.body).toBe(baselineRaw);
  });
});
