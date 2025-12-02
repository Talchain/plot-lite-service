import { aggregateProvenance } from '../src/trust/provenance.js';

/**
 * Minimal CLI example for provenance summary & confidence.
 *
 * Run with:
 *   PROVENANCE_ENABLE=1 npx tsx examples/provenance-tracking.ts
 */
async function main() {
  const graph = {
    nodes: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'C' },
    ],
    edges: [
      { from: 'A', to: 'B', provenance_note: 'Study 2024' },
      { from: 'B', to: 'C', provenance_note: 'Expert estimate' },
      { from: 'C', to: 'A', provenance_note: 'template' },
      { from: 'A', to: 'C' },
    ],
  };

  const summary = aggregateProvenance(graph as any);

  console.log('Provenance Summary Example');
  console.log('===========================');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('provenance-tracking example failed:', err);
  process.exitCode = 1;
});
