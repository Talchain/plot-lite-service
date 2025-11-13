#!/usr/bin/env node
/**
 * Node.js example: runBatch + optimise with idempotency keys
 */

import { runBatch, optimise } from '@olumi/plot-sdk';
import { randomBytes } from 'crypto';

const BASE_URL = process.env.PLOT_API_URL || 'http://localhost:3000';

console.log('🚀 PLoT SDK Node.js Example\n');
console.log(`Base URL: ${BASE_URL}\n`);

// Generate idempotency keys
const batchKey = randomBytes(16).toString('hex');
const optimiseKey = randomBytes(16).toString('hex');

console.log(`Batch Idempotency Key: ${batchKey}`);
console.log(`Optimise Idempotency Key: ${optimiseKey}\n`);

// Example 1: Batch processing
console.log('1️⃣ Running batch inference...');

try {
  const batchResult = await runBatch({
    baseUrl: BASE_URL,
    idempotencyKey: batchKey,
    items: [
      {
        graph: {
          nodes: [{ id: 'A', label: 'Option A' }],
          edges: []
        },
        seed: 1
      },
      {
        graph: {
          nodes: [{ id: 'B', label: 'Option B' }],
          edges: []
        },
        seed: 2
      },
      {
        graph: {
          nodes: [{ id: 'C', label: 'Option C' }],
          edges: []
        },
        seed: 3
      }
    ]
  });

  console.log(`✅ Batch complete: ${batchResult.results.length} items`);
  batchResult.results.forEach((r, i) => {
    console.log(`   Item ${i + 1}: ${r.response_hash.slice(0, 8)}... (seed: ${r.model_card.seed})`);
  });
  console.log();

} catch (err) {
  console.error(`❌ Batch failed: ${err.message}\n`);
  process.exit(1);
}

// Example 2: Optimisation under budget
console.log('2️⃣ Running optimiser...');

try {
  const optimiseResult = await optimise({
    baseUrl: BASE_URL,
    idempotencyKey: optimiseKey,
    graph: {
      nodes: [
        { id: 'Revenue', label: 'Revenue' },
        { id: 'Cost', label: 'Cost' }
      ],
      edges: []
    },
    budget: 100.0,
    actions: [
      {
        id: 'hire_sales',
        cost: 40.0,
        do: [{ node_id: 'Revenue', set_to: 1.2 }]
      },
      {
        id: 'reduce_overhead',
        cost: 30.0,
        do: [{ node_id: 'Cost', set_to: 0.8 }]
      },
      {
        id: 'expand_market',
        cost: 60.0,
        do: [{ node_id: 'Revenue', set_to: 1.5 }]
      }
    ],
    objective: {
      type: 'utility_linear',
      weights: { Revenue: 1.0, Cost: -0.5 }
    },
    seed: 4242
  });

  console.log(`✅ Optimisation complete`);
  console.log(`   Selected actions: ${optimiseResult.selected.join(', ')}`);
  console.log(`   Expected utility: ${optimiseResult.utility.expected.toFixed(3)}`);
  console.log(`   Solver: ${optimiseResult.meta.solver}`);
  console.log();

} catch (err) {
  console.error(`❌ Optimisation failed: ${err.message}\n`);
  process.exit(1);
}

console.log('✅ All examples completed successfully!');
console.log('\n📝 Notes:');
console.log('- Request IDs are auto-generated');
console.log('- Idempotency keys ensure safe retries');
console.log('- User-Agent header set automatically in Node.js');
