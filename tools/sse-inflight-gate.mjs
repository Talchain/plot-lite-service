#!/usr/bin/env node
/**
 * SSE Inflight Balance Gate
 * Opens/closes 100 SSE connections and verifies inflight returns to 0
 */

const PORT = process.env.PORT || 4311;
const BASE = `http://127.0.0.1:${PORT}`;
const CYCLES = 100;

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

async function getInflight() {
  try {
    const res = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    });
    if (!res.ok) {
      console.error(`❌ Failed to get inflight: ${res.status}`);
      return -1;
    }
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`❌ Wrong content-type: ${contentType}`);
      return -1;
    }
    const data = await res.json();
    return data.inflight;
  } catch (err) {
    console.error(`❌ Error reading inflight: ${err.message}`);
    return -1;
  }
}

async function getInflightStats() {
  try {
    const res = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    });
    if (!res.ok) {
      console.error(`❌ Failed to get stats: ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`❌ Wrong content-type: ${contentType}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`❌ Error reading stats: ${err.message}`);
    return null;
  }
}

async function runGate() {
  console.log(`🔍 SSE Inflight Balance Gate (${CYCLES} cycles)\n`);

  // Wait for server
  const ready = await waitForServer();
  if (!ready) {
    console.error('❌ Server not ready\n');
    process.exit(1);
  }

  // Check initial inflight
  const initial = await getInflight();
  if (initial !== 0) {
    console.error(`❌ Initial inflight is not 0 (got ${initial})\n`);
    process.exit(1);
  }

  console.log(`✅ Initial inflight: 0`);
  console.log(`📊 Running ${CYCLES} SSE open/close cycles...\n`);

  // Run cycles
  for (let i = 0; i < CYCLES; i++) {
    try {
      const res = await fetch(`${BASE}/stream?sleepMs=0`);
      if (!res.ok) {
        console.error(`❌ Cycle ${i + 1}/${CYCLES} failed: ${res.status}\n`);
        process.exit(1);
      }
      await res.text(); // Read to completion
    } catch (err) {
      console.error(`❌ Cycle ${i + 1}/${CYCLES} error: ${err.message}\n`);
      process.exit(1);
    }

    // Log progress every 20 cycles
    if ((i + 1) % 20 === 0) {
      const current = await getInflight();
      console.log(`  ${i + 1}/${CYCLES} cycles complete, inflight: ${current}`);
    }
  }

  // Wait for all cleanup
  await new Promise(r => setTimeout(r, 500));

  // Check final inflight and underflows
  const final = await getInflight();
  const stats = await getInflightStats();
  
  console.log(`\n📋 Summary:`);
  console.log(`  - Cycles: ${CYCLES}`);
  console.log(`  - Initial inflight: ${initial}`);
  console.log(`  - Final inflight: ${final}`);
  console.log(`  - Underflows: ${stats?.underflows ?? 'N/A'}`);

  // Check for inflight imbalance
  if (final !== 0) {
    console.error(`\n❌ FAIL: Inflight not balanced`);
    console.error(`Expected: 0, Got: ${final}`);
    console.error(`\nLeak detected: ${final} request(s) not cleaned up`);
    console.error('Check SSE endStream() is always called and idempotent\n');
    console.error(`GATES: FAIL — inflight=${final} after ${CYCLES} SSE cycles (expected 0)\n`);
    process.exit(1);
  }

  // Check for underflows (strict accounting)
  if (stats && stats.underflows > 0) {
    console.error(`\n❌ FAIL: Underflows detected`);
    console.error(`Expected: 0, Got: ${stats.underflows}`);
    console.error(`\nDouble-decrement detected: check endStream() and onResponse hooks`);
    console.error(`GATES: FAIL — underflows=${stats.underflows} detected during ${CYCLES} SSE cycles\n`);
    process.exit(1);
  }

  console.log(`\n✅ All SSE connections balanced`);
  console.log(`✅ No underflows (strict accounting)`);
  console.log(`\nGATES: PASS — inflight balanced after ${CYCLES} SSE cycles (underflows=0)\n`);
  process.exit(0);
}

runGate();
