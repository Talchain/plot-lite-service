#!/usr/bin/env node
/**
 * 10-minute soak test
 * Hits /v1/run, /v1/compare, /v1/inspect at ~1-2 RPS
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DURATION_MS = 10 * 60 * 1000; // 10 minutes
const TARGET_RPS = 1.5;
const INTERVAL_MS = 1000 / TARGET_RPS;

const routes = [
  {
    path: '/v1/run',
    body: {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B' }]
      },
      seed: 4242
    }
  },
  {
    path: '/v1/compare',
    body: {
      graphs: [
        {
          graph: {
            nodes: [{ id: 'A', label: 'A' }],
            edges: []
          },
          label: 'Base'
        },
        {
          graph: {
            nodes: [{ id: 'A', label: 'A', value: 0.8 }],
            edges: []
          },
          label: 'Alt'
        }
      ],
      seed: 4242
    }
  },
  {
    path: '/v1/inspect',
    body: {
      graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      seed: 4242
    }
  }
];

const stats = {
  ok: 0,
  err: 0,
  latencies: []
};

async function makeRequest(route) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${route.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route.body)
    });
    
    const latency = Date.now() - start;
    stats.latencies.push(latency);
    
    if (res.ok) {
      stats.ok++;
    } else {
      stats.err++;
      console.error(`[ERR] ${route.path} → ${res.status}`);
    }
  } catch (err) {
    stats.err++;
    console.error(`[ERR] ${route.path} → ${err.message}`);
  }
}

function getLatencyBuckets() {
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
    max: Math.max(...sorted, 0)
  };
}

async function run() {
  console.log(`Starting 10-minute soak test...`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`RPS: ~${TARGET_RPS}`);
  console.log(`Duration: ${DURATION_MS / 1000}s\n`);

  const startTime = Date.now();
  let requestCount = 0;

  while (Date.now() - startTime < DURATION_MS) {
    const route = routes[requestCount % routes.length];
    makeRequest(route); // Fire and forget
    requestCount++;
    
    // Progress every 30s
    if (requestCount % 45 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const buckets = getLatencyBuckets();
      console.log(`[${elapsed}s] OK: ${stats.ok}, ERR: ${stats.err}, p95: ${buckets.p95}ms`);
    }
    
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }

  // Wait for in-flight requests
  await new Promise(resolve => setTimeout(resolve, 2000));

  const buckets = getLatencyBuckets();
  console.log(`\n=== Soak Test Complete ===`);
  console.log(`Duration: ${Math.floor((Date.now() - startTime) / 1000)}s`);
  console.log(`Requests: ${stats.ok + stats.err}`);
  console.log(`OK: ${stats.ok}`);
  console.log(`ERR: ${stats.err}`);
  console.log(`Latency: p50=${buckets.p50}ms p95=${buckets.p95}ms p99=${buckets.p99}ms max=${buckets.max}ms`);

  if (stats.err > stats.ok * 0.01) {
    console.error(`\n❌ Error rate too high: ${((stats.err / (stats.ok + stats.err)) * 100).toFixed(2)}%`);
    process.exit(1);
  }

  console.log(`\n✅ Soak test passed`);
}

run().catch(err => {
  console.error('Soak test failed:', err);
  process.exit(1);
});
