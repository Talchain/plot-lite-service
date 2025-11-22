import { PlotLiteClient } from '../../src/index.js';

async function main() {
  const client = new PlotLiteClient('http://localhost:3000');

  // Basic run
  const result = await client.run({
    graph: {
      nodes: [
        { id: 'A', label: 'Price' },
        { id: 'B', label: 'Demand' },
        { id: 'C', label: 'Revenue' }
      ],
      edges: [
        { from: 'A', to: 'B', weight: -0.8 },
        { from: 'B', to: 'C', weight: 0.9 }
      ]
    },
    seed: 4242
  });

  console.log('Run Result:');
  console.log('  Schema:', result.schema);
  console.log('  Summary:', result.summary);
  console.log('  Confidence:', result.confidence);
  console.log('  Seed:', result.meta.seed);
  console.log('  Response Hash:', result.model_card.response_hash);
}

main().catch(console.error);
