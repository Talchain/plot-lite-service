#!/usr/bin/env node
/**
 * Load probe for staging validation (C6)
 * Runs ~25 RPS for 2min, appends to evidence/slos.live.json
 */
import axios from 'axios';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STAGING_URL = process.env.PLOT_STAGING_URL;
const AUTH_TOKEN = process.env.PLOT_AUTH_TOKEN;
const RPS = 25;
const DURATION_SEC = 120;
const SLO_CLIENT_P95 = Number(process.env.SLO_CLIENT_P95_MS || 600);
const SLO_SERVER_P95 = Number(process.env.SLO_SERVER_P95_MS || 100);

if (!STAGING_URL) {
  console.log('⏭️  Skipped (missing PLOT_STAGING_URL)');
  process.exit(0);
}

const payload = {
  seed: 4242,
  graph: {
    nodes: [
      { id: "Price", label: "Price" },
      { id: "Demand", label: "Demand" },
      { id: "Revenue", label: "Revenue" }
    ],
    edges: [
      { from: "Price", to: "Demand", weight: -0.5, belief: 0.8 },
      { from: "Demand", to: "Revenue", weight: 0.8, belief: 0.9 }
    ]
  },
  outcome_node: "Revenue"
};

function percentile(arr, p) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function probe() {
  console.log(`🔍 Load probe: ${RPS} RPS × ${DURATION_SEC}s → ${STAGING_URL}`);
  
  const latencies = [];
  const totalRequests = RPS * DURATION_SEC;
  const intervalMs = 1000 / RPS;
  
  let completed = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < totalRequests; i++) {
    const reqStart = Date.now();
    
    axios.post(`${STAGING_URL}/v1/run`, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {})
      },
      timeout: 10000
    }).then(() => {
      latencies.push(Date.now() - reqStart);
      completed++;
    }).catch(err => {
      console.error(`Request ${i} failed:`, err.message);
      completed++;
    });
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  // Wait for stragglers
  const waitStart = Date.now();
  while (completed < totalRequests && Date.now() - waitStart < 30000) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const clientP95 = percentile(latencies, 95);
  console.log(`✅ Client p95: ${clientP95}ms (${latencies.length}/${totalRequests} completed)`);
  
  // Fetch server metrics
  let serverP95 = null;
  try {
    const healthRes = await axios.get(`${STAGING_URL}/v1/health`, {
      headers: AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {}
    });
    serverP95 = healthRes.data.engine_p95_ms_rolling || null;
    console.log(`📊 Server p95 rolling: ${serverP95}ms`);
  } catch (err) {
    console.warn('⚠️  Could not fetch server metrics:', err.message);
  }
  
  // Append to evidence pack
  const evidencePath = resolve(process.cwd(), 'evidence', 'slos.live.json');
  let entries = [];
  if (existsSync(evidencePath)) {
    try {
      entries = JSON.parse(readFileSync(evidencePath, 'utf8'));
    } catch {}
  }
  
  entries.push({
    timestamp: new Date().toISOString(),
    client_p95_ms: clientP95,
    server_p95_ms_rolling: serverP95,
    rps: RPS,
    sample_size: latencies.length,
    slo_client_p95_ms: SLO_CLIENT_P95,
    slo_server_p95_ms: SLO_SERVER_P95,
    pass: clientP95 <= SLO_CLIENT_P95 && (serverP95 === null || serverP95 <= SLO_SERVER_P95)
  });
  
  writeFileSync(evidencePath, JSON.stringify(entries, null, 2));
  console.log(`📝 Appended to ${evidencePath}`);
  
  // Exit with status
  if (clientP95 > SLO_CLIENT_P95) {
    console.error(`❌ Client p95 ${clientP95}ms exceeds SLO ${SLO_CLIENT_P95}ms`);
    process.exit(1);
  }
  if (serverP95 !== null && serverP95 > SLO_SERVER_P95) {
    console.error(`❌ Server p95 ${serverP95}ms exceeds SLO ${SLO_SERVER_P95}ms`);
    process.exit(1);
  }
  
  console.log('✅ SLOs met');
  process.exit(0);
}

probe().catch(err => {
  console.error('💥 Probe failed:', err);
  process.exit(1);
});
