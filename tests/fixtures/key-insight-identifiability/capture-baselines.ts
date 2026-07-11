/**
 * Baseline capture script for the identifiability thread-through lane
 * (CEE #427 follow-up).
 *
 * Captures, from the CURRENT code, two byte-identity pins:
 *   1. baseline-cee-request.json  — the outbound CEE key-insight proxy request
 *      body (flag on, fetch stubbed), with the per-request `plot_request_id`
 *      removed (it is a per-request correlation id, not a stable byte).
 *   2. baseline-response.json     — the proxy's own HTTP response to its
 *      caller (flag off, fixed seed), raw bytes.
 *
 * Provenance: captured at origin/staging cd369634d BEFORE the identifiability
 * thread-through, i.e. these baselines prove today's proxy request carries NO
 * `identifiability` field. Do not regenerate casually — the point of the pin
 * is that the absent-computation path stays byte-identical to this capture.
 *
 * Run from repo root:
 *   npx tsx tests/fixtures/key-insight-identifiability/capture-baselines.ts
 */

import Fastify from 'fastify';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { registerKeyInsightRoute } from '../../../src/routes/v1/key-insight.js';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

/** Identifiable chain graph: a -> b -> c, no confounders. */
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

async function captureCeeRequest(): Promise<void> {
  process.env.CEE_KEY_INSIGHT_ENABLE = '1';
  process.env.CEE_BASE_URL = 'http://cee.test';
  process.env.CEE_API_KEY = 'test-key';

  let capturedBody: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, opts: { body?: string }) => {
    capturedBody = opts?.body;
    return {
      ok: true,
      json: async () => ({ insight: 'stub insight', confidence: 'high' }),
    };
  }) as unknown as typeof fetch;

  try {
    const app = Fastify({ logger: false });
    await registerKeyInsightRoute(app);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/assist/key-insight',
      payload: PIN_PAYLOAD,
    });
    await app.close();
    if (res.statusCode !== 200) {
      throw new Error(`capture failed: HTTP ${res.statusCode}: ${res.body}`);
    }
    if (!capturedBody) {
      throw new Error('capture failed: CEE fetch was not invoked');
    }
    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    delete parsed.plot_request_id; // per-request correlation id
    writeFileSync(
      join(OUT_DIR, 'baseline-cee-request.json'),
      JSON.stringify(parsed)
    );
    console.log('wrote baseline-cee-request.json');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CEE_KEY_INSIGHT_ENABLE;
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
  }
}

async function captureResponse(): Promise<void> {
  delete process.env.CEE_KEY_INSIGHT_ENABLE;
  delete process.env.CEE_ORCHESTRATOR_ENABLED;

  const app = Fastify({ logger: false });
  await registerKeyInsightRoute(app);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/assist/key-insight',
    payload: PIN_PAYLOAD,
  });
  await app.close();
  if (res.statusCode !== 200) {
    throw new Error(`capture failed: HTTP ${res.statusCode}: ${res.body}`);
  }
  writeFileSync(join(OUT_DIR, 'baseline-response.json'), res.body);
  console.log('wrote baseline-response.json');
}

await captureCeeRequest();
await captureResponse();
