#!/usr/bin/env node
/**
 * Determinism Gate - Strict Mode
 * Runs same query 20 times and verifies identical outputs
 */

const PORT = process.env.PORT || 4311;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = 20;

const testGraph = {
  nodes: [
    { id: 'n1', label: 'Price' },
    { id: 'n2', label: 'Demand' },
    { id: 'n3', label: 'Revenue' },
  ],
  edges: [
    { from: 'n1', to: 'n2', weight: 0.8 },
    { from: 'n2', to: 'n3', weight: 0.9 },
  ],
};

async function waitForServer(maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function runTest() {
  console.log(`🧪 Determinism Gate - Strict Mode (${RUNS} runs)\n`);

  // Wait for server
  const ready = await waitForServer();
  if (!ready) {
    console.error('❌ Server not ready\n');
    process.exit(1);
  }

  const seed = 4242;
  const payload = {
    graph: testGraph,
    seed,
    k_samples: 1000,
  };

  console.log(`📊 Running /v1/run with seed=${seed} ${RUNS} times...\n`);

  const responses = [];
  for (let i = 0; i < RUNS; i++) {
    try {
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error(`❌ Request ${i + 1}/${RUNS} failed: ${res.status}\n`);
        process.exit(1);
      }

      const data = await res.json();
      responses.push(data);
    } catch (err) {
      console.error(`❌ Request ${i + 1}/${RUNS} error: ${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(`✅ ${RUNS} requests completed\n`);

  // Verify all responses have required fields
  for (let i = 0; i < RUNS; i++) {
    const resp = responses[i];
    if (!resp.model_card) {
      console.error(`❌ Response ${i + 1} missing model_card\n`);
      process.exit(1);
    }
    if (!resp.confidence) {
      console.error(`❌ Response ${i + 1} missing confidence\n`);
      process.exit(1);
    }
    if (!resp.explain_delta) {
      console.error(`❌ Response ${i + 1} missing explain_delta\n`);
      process.exit(1);
    }
  }

  // Strict determinism check: all must be identical
  const first = JSON.stringify(responses[0].explain_delta);
  const firstModelCard = JSON.stringify(responses[0].model_card);
  const firstConfidence = JSON.stringify(responses[0].confidence);

  let driftCount = 0;
  const drifts = [];

  for (let i = 1; i < RUNS; i++) {
    const currentDelta = JSON.stringify(responses[i].explain_delta);
    const currentCard = JSON.stringify(responses[i].model_card);
    const currentConf = JSON.stringify(responses[i].confidence);

    if (currentDelta !== first) {
      driftCount++;
      drifts.push({ run: i + 1, field: 'explain_delta' });
    }
    if (currentCard !== firstModelCard) {
      driftCount++;
      drifts.push({ run: i + 1, field: 'model_card' });
    }
    if (currentConf !== firstConfidence) {
      driftCount++;
      drifts.push({ run: i + 1, field: 'confidence' });
    }
  }

  if (driftCount > 0) {
    console.error(`❌ FAIL: Determinism drift detected\n`);
    console.error(`Found ${driftCount} mismatches across ${RUNS} runs:\n`);
    
    for (const drift of drifts.slice(0, 10)) {
      console.error(`  - Run ${drift.run}: ${drift.field} differs\n`);
    }
    
    console.error('\nRoot cause: Non-deterministic computation in trust signals');
    console.error('Check for: Math.random(), Date.now(), non-stable sorts, etc.\n');
    
    console.error('GATES: FAIL — determinism unstable\n');
    process.exit(1);
  }

  console.log('✅ All responses identical (strict mode)\n');
  console.log(`📋 Summary:`);
  console.log(`  - Runs: ${RUNS}`);
  console.log(`  - Seed: ${seed}`);
  console.log(`  - Drift: 0 (perfect)`);
  console.log(`  - Fields checked: explain_delta, model_card, confidence\n`);

  console.log('GATES: PASS — determinism stable (20 runs, strict)\n');
  process.exit(0);
}

runTest();
