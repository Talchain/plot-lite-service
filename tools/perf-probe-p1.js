/**
 * Performance probe for P1A/P1B
 * Canonical case: 12 nodes, 24 edges, seed 4242, k=1000
 */

const CANONICAL_GRAPH = {
  nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
  edges: [
    // Create 24 edges in a realistic pattern
    { from: 'n0', to: 'n1', weight: 1.2 },
    { from: 'n0', to: 'n2', weight: 0.8 },
    { from: 'n1', to: 'n3', weight: 1.5 },
    { from: 'n1', to: 'n4', weight: 0.9 },
    { from: 'n2', to: 'n4', weight: 1.1 },
    { from: 'n2', to: 'n5', weight: 0.7 },
    { from: 'n3', to: 'n6', weight: 1.3 },
    { from: 'n3', to: 'n7', weight: 1.0 },
    { from: 'n4', to: 'n7', weight: 0.6 },
    { from: 'n4', to: 'n8', weight: 1.4 },
    { from: 'n5', to: 'n8', weight: 0.9 },
    { from: 'n5', to: 'n9', weight: 1.2 },
    { from: 'n6', to: 'n10', weight: 1.1 },
    { from: 'n6', to: 'n11', weight: 0.8 },
    { from: 'n7', to: 'n10', weight: 1.0 },
    { from: 'n7', to: 'n11', weight: 1.3 },
    { from: 'n8', to: 'n11', weight: 0.7 },
    { from: 'n9', to: 'n11', weight: 1.5 },
    { from: 'n0', to: 'n5', weight: 0.5 },
    { from: 'n1', to: 'n6', weight: 0.6 },
    { from: 'n2', to: 'n7', weight: 0.9 },
    { from: 'n3', to: 'n9', weight: 1.1 },
    { from: 'n4', to: 'n10', weight: 0.8 },
    { from: 'n5', to: 'n11', weight: 1.2 },
  ],
};

async function probe() {
  const runs = 100;
  const times = [];
  
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const res = await fetch('http://127.0.0.1:4311/v1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: CANONICAL_GRAPH,
        seed: 4242,
        k_samples: 1000,
        include_debug: true,
      }),
    });
    const end = performance.now();
    
    if (res.status !== 200) {
      console.error(`Run ${i} failed: ${res.status}`);
      continue;
    }
    
    times.push(end - start);
  }
  
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(runs * 0.5)];
  const p95 = times[Math.floor(runs * 0.95)];
  const p99 = times[Math.floor(runs * 0.99)];
  
  console.log(`\nPerformance Probe (${runs} runs):`);
  console.log(`  p50: ${p50.toFixed(2)} ms`);
  console.log(`  p95: ${p95.toFixed(2)} ms`);
  console.log(`  p99: ${p99.toFixed(2)} ms`);
  console.log(`\n✅ Target: p95 ≤ 600 ms`);
  console.log(`   Result: ${p95 <= 600 ? 'PASS' : 'FAIL'}`);
}

probe().catch(console.error);
