#!/usr/bin/env node
import { createServer } from '../dist/createServer.js';
import { sha256Stable } from '../dist/util/canonical-json.js';
import { writeFile } from 'fs/promises';

const GOLDEN_GRAPH = {
  nodes: [
    { id: 'Price', label: 'Price' },
    { id: 'Demand', label: 'Demand' },
    { id: 'Revenue', label: 'Revenue' }
  ],
  edges: [
    { from: 'Price', to: 'Demand', weight: 1 },
    { from: 'Demand', to: 'Revenue', weight: 1 }
  ]
};

async function refresh() {
  console.log('🔄 Refreshing self-check golden hash...\n');
  
  process.env.TEST_ROUTES = '1';
  const app = await createServer({ enableTestRoutes: true });
  
  try {
    const scRes = await app.inject({ method: 'GET', url: '/v1/self-check' });
    const scBody = scRes.json();
    
    const runRes = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_GRAPH, seed: 4242 }
    });
    const runBody = runRes.json();
    const runHash = sha256Stable(runBody);
    
    console.log('Self-check hash:', scBody.hash);
    console.log('/v1/run hash:   ', runHash);
    console.log('Match:', scBody.hash === runHash ? '✅' : '❌\n');
    
    await writeFile('selfcheck-golden.json', JSON.stringify({
      timestamp: new Date().toISOString(),
      selfcheck_hash: scBody.hash,
      run_hash: runHash,
      match: scBody.hash === runHash
    }, null, 2));
    
    console.log('\n📝 Written to selfcheck-golden.json');
  } finally {
    await app.close();
  }
}

refresh().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
