#!/usr/bin/env node
import { createServer } from '../dist/createServer.js';

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

const app = await createServer({ enableTestRoutes: false });
const hashes = new Set();

for (let i = 0; i < 10; i++) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/run',
    payload
  });
  const body = JSON.parse(res.body);
  hashes.add(body.model_card.response_hash);
}

await app.close();

if (hashes.size === 1) {
  console.log(`✅ Determinism: 10 runs → 1 hash: ${[...hashes][0]}`);
  process.exit(0);
} else {
  console.error(`❌ FAILED: ${hashes.size} unique hashes`);
  process.exit(1);
}
