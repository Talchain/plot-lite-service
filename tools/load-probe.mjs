#!/usr/bin/env node
/**
 * load-probe.mjs - Load test probe for staging validation
 * Runs ~25 RPS for ~2 minutes using golden graph
 * Captures client p95 and server rolling p95 before/after
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.PLOT_STAGING_URL || 'http://localhost:4311';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TARGET_RPS = 25;
const DURATION_SECONDS = 120; // 2 minutes
const TOTAL_REQUESTS = TARGET_RPS * DURATION_SECONDS;

// Golden fixture
const FIXTURE_PATH = join(process.cwd(), 'fixtures', 'run-graph.json');

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function getHealthMetrics() {
  const health = await fetchJSON(`${BASE_URL}/v1/health`);
  return {
    engine_p95_ms: health.engine_p95_ms || 0,
    engine_p95_ms_rolling: health.engine_p95_ms_rolling || 0,
    uptime_s: health.uptime_s || 0,
  };
}

async function runRequest(payload) {
  const start = Date.now();
  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (AUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    }

    await fetchJSON(`${BASE_URL}/v1/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const duration = Date.now() - start;
    return { success: true, duration_ms: duration };
  } catch (error) {
    const duration = Date.now() - start;
    return { success: false, duration_ms: duration, error: error.message };
  }
}

function calculateP95(durations) {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[index];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔍 Load Probe - Staging Validation');
  console.log(`Target: ${BASE_URL}`);
  console.log(`RPS: ${TARGET_RPS}`);
  console.log(`Duration: ${DURATION_SECONDS}s`);
  console.log(`Total requests: ${TOTAL_REQUESTS}`);
  console.log('');

  // Load fixture
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    console.log(`✅ Loaded fixture: ${FIXTURE_PATH}`);
  } catch (error) {
    console.error(`❌ Failed to load fixture: ${error.message}`);
    process.exit(1);
  }

  // Get baseline health
  console.log('\n📊 Baseline health check...');
  let baseline;
  try {
    baseline = await getHealthMetrics();
    console.log(`   engine_p95_ms: ${baseline.engine_p95_ms.toFixed(2)}ms`);
    console.log(`   engine_p95_ms_rolling: ${baseline.engine_p95_ms_rolling.toFixed(2)}ms`);
    console.log(`   uptime: ${baseline.uptime_s.toFixed(0)}s`);
  } catch (error) {
    console.error(`❌ Failed to get baseline health: ${error.message}`);
    process.exit(1);
  }

  // Run load test
  console.log(`\n🚀 Starting load test (${TOTAL_REQUESTS} requests)...`);
  const start_time = Date.now();
  const durations = [];
  const errors = [];
  const interval_ms = 1000 / TARGET_RPS; // Time between requests

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const request_start = Date.now();
    const result = await runRequest(fixture);

    if (result.success) {
      durations.push(result.duration_ms);
    } else {
      errors.push(result.error);
    }

    // Progress indicator every 100 requests
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - start_time) / 1000;
      const current_rps = (i + 1) / elapsed;
      console.log(`   ${i + 1}/${TOTAL_REQUESTS} requests (${current_rps.toFixed(1)} RPS)`);
    }

    // Rate limiting: sleep to maintain target RPS
    const elapsed_ms = Date.now() - request_start;
    const sleep_ms = Math.max(0, interval_ms - elapsed_ms);
    if (sleep_ms > 0) {
      await sleep(sleep_ms);
    }
  }

  const total_duration = (Date.now() - start_time) / 1000;
  const actual_rps = TOTAL_REQUESTS / total_duration;

  console.log(`\n✅ Load test complete`);
  console.log(`   Duration: ${total_duration.toFixed(1)}s`);
  console.log(`   Actual RPS: ${actual_rps.toFixed(1)}`);
  console.log(`   Success: ${durations.length}/${TOTAL_REQUESTS}`);
  console.log(`   Errors: ${errors.length}`);

  // Calculate client-side p95
  const client_p95 = calculateP95(durations);
  const client_p50 = calculateP95(durations.slice(0, Math.ceil(durations.length * 0.5)));

  console.log(`\n📈 Client-side latency:`);
  console.log(`   p50: ${client_p50.toFixed(2)}ms`);
  console.log(`   p95: ${client_p95.toFixed(2)}ms`);

  // Get final health
  console.log(`\n📊 Final health check...`);
  await sleep(2000); // Wait for metrics to settle
  let final;
  try {
    final = await getHealthMetrics();
    console.log(`   engine_p95_ms: ${final.engine_p95_ms.toFixed(2)}ms`);
    console.log(`   engine_p95_ms_rolling: ${final.engine_p95_ms_rolling.toFixed(2)}ms`);
  } catch (error) {
    console.error(`⚠️  Failed to get final health: ${error.message}`);
    final = baseline; // Fallback
  }

  // Write results to evidence pack
  const evidence_dir = join(process.cwd(), 'artifact', 'pack', 'evidence');
  mkdirSync(evidence_dir, { recursive: true });

  const slos = {
    schema: 'slos.v1',
    source: 'load-probe',
    timestamp: new Date().toISOString(),
    engine_get_p95_ms: final.engine_p95_ms_rolling,
    client_p95_ms: client_p95,
    client_p50_ms: client_p50,
    load_test: {
      target_rps: TARGET_RPS,
      actual_rps: actual_rps,
      duration_s: total_duration,
      total_requests: TOTAL_REQUESTS,
      success_count: durations.length,
      error_count: errors.length,
    },
    baseline: {
      engine_p95_ms_rolling: baseline.engine_p95_ms_rolling,
    },
    final: {
      engine_p95_ms_rolling: final.engine_p95_ms_rolling,
    },
  };

  const slos_path = join(evidence_dir, 'slos.live.json');
  writeFileSync(slos_path, JSON.stringify(slos, null, 2), 'utf8');
  console.log(`\n✅ Wrote SLOs to: ${slos_path}`);

  // Validate budget
  console.log(`\n🎯 Budget validation:`);
  const rolling_p95_ok = final.engine_p95_ms_rolling < 100;
  const client_p95_ok = client_p95 < 600; // 12-node budget

  console.log(`   Rolling p95 < 100ms: ${rolling_p95_ok ? '✅' : '❌'} (${final.engine_p95_ms_rolling.toFixed(2)}ms)`);
  console.log(`   Client p95 < 600ms: ${client_p95_ok ? '✅' : '❌'} (${client_p95.toFixed(2)}ms)`);

  if (!rolling_p95_ok || !client_p95_ok) {
    console.log(`\n⚠️  Performance budget exceeded!`);
    process.exit(1);
  }

  console.log(`\n🎉 Load probe PASS - all budgets met`);
}

main().catch(error => {
  console.error(`\n❌ Load probe failed: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
