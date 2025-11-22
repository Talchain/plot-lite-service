#!/usr/bin/env node
/**
 * Generate Contract Snapshot for report.v1
 * 
 * Calls /v1/self-check endpoint and saves the normalized report
 * as contracts/snapshots/report.v1.example.json
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4311';
const OUTPUT = resolve(process.cwd(), 'contracts/snapshots/report.v1.example.json');

async function main() {
  console.log('🔍 Generating contract snapshot from /v1/self-check...\n');

  try {
    // Start server if not already running
    const healthRes = await fetch(`${BASE}/health`).catch(() => null);
    if (!healthRes || !healthRes.ok) {
      console.error('❌ Server not running. Start with: TEST_ROUTES=1 node dist/main.js');
      process.exit(1);
    }

    // Get self-check response
    const res = await fetch(`${BASE}/v1/self-check`);
    if (!res.ok) {
      console.error(`❌ /v1/self-check returned ${res.status}`);
      process.exit(1);
    }

    const data = await res.json();
    
    if (!data.schema || data.schema !== 'self_check.v1') {
      console.error('❌ Unexpected response schema');
      process.exit(1);
    }

    // Import canonical-json functions
    const { stableStringify, normaliseReport } = await import('../dist/util/canonical-json.js');
    
    // Import the actual route logic to get the report
    // For now, we'll make a direct /v1/run call with the golden scenario
    const { GOLDEN_SCENARIO } = await import('../dist/fixtures/self-check.js');
    
    const runRes = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...GOLDEN_SCENARIO,
        treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
        outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
        baseline_value: 100,
      }),
    });

    if (!runRes.ok) {
      console.error(`❌ /v1/run returned ${runRes.status}`);
      const error = await runRes.text();
      console.error(error);
      process.exit(1);
    }

    const report = await runRes.json();
    
    // Normalise and stringify
    const normalised = normaliseReport(report);
    const canonical = stableStringify(normalised);
    
    // Write to file
    await writeFile(OUTPUT, canonical, 'utf-8');
    
    console.log(`✅ Contract snapshot written to: ${OUTPUT}`);
    console.log(`   Schema: ${report.schema}`);
    console.log(`   Size: ${canonical.length} bytes`);
    console.log(`   Hash from self-check: ${data.hash}`);
    console.log(`\nSnapshot ready for review and commit.\n`);
    
  } catch (err) {
    console.error(`❌ Failed to generate snapshot: ${err.message}`);
    process.exit(1);
  }
}

main();
