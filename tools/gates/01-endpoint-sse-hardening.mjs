#!/usr/bin/env node
/**
 * Phase 1: Endpoint & SSE hardening
 * - Strong ETag for GET /draft-flows
 * - HEAD parity
 * - If-None-Match → 304
 * - SSE stability soak test (500 cycles)
 */

import { createServer } from '../../src/createServer.js';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

process.env.TEST_ROUTES = '1';
process.env.FEATURE_STREAM = '1';

const PORT = 14311;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

let app;
let metrics = {
  etag_matches: 0,
  head_parity: 0,
  not_modified_304: 0,
  sse_completed: 0,
  inflight_underflows: 0,
  missed_heartbeats: 0,
};

async function main() {
  console.log('GATES: Phase 1 — Endpoint & SSE hardening');

  // Start server
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: PORT, host: HOST });
  console.log(`  Server started on ${BASE}`);

  // Test 1: Strong ETag on GET /draft-flows
  console.log('  [1/4] Testing strong ETag for GET /draft-flows');
  const etag1 = await testStrongETag();
  if (!etag1) throw new Error('ETag missing or weak');
  metrics.etag_matches++;

  // Test 2: HEAD parity
  console.log('  [2/4] Testing HEAD parity');
  await testHeadParity(etag1);
  metrics.head_parity++;

  // Test 3: If-None-Match → 304
  console.log('  [3/4] Testing If-None-Match → 304');
  await testIfNoneMatch(etag1);
  metrics.not_modified_304++;

  // Test 4: SSE stability soak (500 cycles)
  console.log('  [4/4] SSE stability soak (500 cycles)');
  await sseStabilitySoak(500);

  await app.close();

  // Validate final metrics
  const finalInflight = app.inflight.count();
  if (finalInflight !== 0) {
    metrics.inflight_underflows++;
    throw new Error(`Inflight counter leaked: ${finalInflight}`);
  }

  console.log(`GATES: PASS — draft-flows deterministic (etag/head/304 OK), SSE stable (N=500, inflight=${finalInflight})`);
  process.exit(0);
}

async function testStrongETag() {
  const url = `${BASE}/draft-flows?template=pricing_change&seed=4242`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);

  const etag = res.headers.get('etag');
  if (!etag || etag.startsWith('W/')) throw new Error('ETag must be strong');

  const body = await res.arrayBuffer();
  const computed = '"' + createHash('sha256').update(Buffer.from(body)).digest('hex') + '"';

  if (etag !== computed) {
    throw new Error(`ETag mismatch: got ${etag}, computed ${computed}`);
  }

  return etag;
}

async function testHeadParity(expectedEtag) {
  const url = `${BASE}/draft-flows?template=pricing_change&seed=4242`;
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) throw new Error(`HEAD failed: ${res.status}`);

  const etag = res.headers.get('etag');
  const contentLength = res.headers.get('content-length');
  const contentType = res.headers.get('content-type');

  if (etag !== expectedEtag) throw new Error(`HEAD ETag mismatch`);
  if (!contentLength || Number(contentLength) <= 0) throw new Error(`HEAD missing Content-Length`);
  if (contentType !== 'application/json') throw new Error(`HEAD Content-Type mismatch`);
}

async function testIfNoneMatch(etag) {
  const url = `${BASE}/draft-flows?template=pricing_change&seed=4242`;
  const res = await fetch(url, { headers: { 'If-None-Match': etag } });

  if (res.status !== 304) {
    throw new Error(`Expected 304, got ${res.status}`);
  }

  const body = await res.text();
  if (body.length > 0) {
    throw new Error(`304 response must have empty body, got ${body.length} bytes`);
  }
}

async function sseStabilitySoak(cycles) {
  for (let i = 0; i < cycles; i++) {
    const url = `${BASE}/stream?id=soak_${i}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`SSE failed: ${res.status}`);
    if (!res.body) throw new Error('No SSE body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let events = 0;
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('event:')) events++;
        if (line.includes('event: done')) done = true;
      }
    }

    if (events === 0) throw new Error('No SSE events received');
    metrics.sse_completed++;

    // Check inflight counter didn't underflow
    const inflight = app.inflight.count();
    if (inflight < 0) {
      metrics.inflight_underflows++;
      throw new Error(`Inflight underflow: ${inflight}`);
    }
  }
}

main().catch(err => {
  console.error('GATES: FAIL — endpoint-sse-hardening:', err.message);
  if (app) app.close().catch(() => {});
  process.exit(1);
});
