#!/usr/bin/env node
/**
 * Phase 3: Ajv runtime validation
 * - Attach schemas to /v1/run, /v1/counterfactual, /v1/critique
 * - Enforce bounds on all numeric fields
 * - Return BAD_INPUT envelope on violation
 * - 12 bounds tests must PASS
 */

import { validateRequest } from '../../lib/validation/ajv.mjs';

const tests = [
  // Oversized graph
  {
    name: 'oversized_nodes',
    endpoint: 'run',
    payload: {
      graph: {
        nodes: Array.from({ length: 101 }, (_, i) => ({ id: `n${i}` })),
        edges: [],
      },
    },
    expectFail: true,
  },
  // Missing required field
  {
    name: 'missing_graph',
    endpoint: 'run',
    payload: { seed: 42 },
    expectFail: true,
  },
  // Numeric out of range (seed)
  {
    name: 'seed_negative',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      seed: -1,
    },
    expectFail: true,
  },
  {
    name: 'seed_too_large',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      seed: 2147483648,
    },
    expectFail: true,
  },
  // k_samples out of range
  {
    name: 'k_samples_too_small',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      k_samples: 5,
    },
    expectFail: true,
  },
  {
    name: 'k_samples_too_large',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      k_samples: 10001,
    },
    expectFail: true,
  },
  // Edge weight out of range
  {
    name: 'edge_weight_negative',
    endpoint: 'run',
    payload: {
      graph: {
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ from: 'a', to: 'b', weight: -0.1 }],
      },
    },
    expectFail: true,
  },
  {
    name: 'edge_weight_too_large',
    endpoint: 'run',
    payload: {
      graph: {
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ from: 'a', to: 'b', weight: 1.1 }],
      },
    },
    expectFail: true,
  },
  // baseline_value out of range
  {
    name: 'baseline_negative',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      baseline_value: -100,
    },
    expectFail: true,
  },
  {
    name: 'baseline_too_large',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
      baseline_value: 1e13,
    },
    expectFail: true,
  },
  // Valid payloads (should pass)
  {
    name: 'valid_minimal',
    endpoint: 'run',
    payload: {
      graph: { nodes: [{ id: 'a' }], edges: [] },
    },
    expectFail: false,
  },
  {
    name: 'valid_full',
    endpoint: 'run',
    payload: {
      graph: {
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ from: 'a', to: 'b', weight: 0.5 }],
      },
      seed: 4242,
      k_samples: 1000,
      baseline_value: 100.5,
    },
    expectFail: false,
  },
];

async function main() {
  console.log('GATES: Phase 3 — Ajv runtime validation');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = validateRequest(test.endpoint, test.payload);

    if (test.expectFail) {
      if (result.ok) {
        console.error(`  [FAIL] ${test.name}: expected validation to fail but it passed`);
        failed++;
      } else {
        passed++;
      }
    } else {
      if (!result.ok) {
        console.error(`  [FAIL] ${test.name}: expected validation to pass but it failed:`, result.errors);
        failed++;
      } else {
        passed++;
      }
    }
  }

  if (failed > 0) {
    throw new Error(`${failed}/${tests.length} tests failed`);
  }

  console.log(`GATES: PASS — runtime validation OK (${passed}/${tests.length} bounds)`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — ajv-validation:', err.message);
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('reports/diag/03-ajv-validation.json', JSON.stringify({
      phase: '03-ajv-validation',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
  });
  process.exit(1);
});
