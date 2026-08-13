/**
 * ⛔ WITHDRAWN 2026-08-13 — this example no longer demonstrates a working call.
 *
 * `/v1/run_timeslices` answers 501 (`code: ANALYSIS_UNAVAILABLE`,
 * `retryable: false`) for every input. It was ruled FABRICATING: the published
 * percentiles were a closed-form function of the seed and the SHA-256 of the
 * slice NAME, with the request graph — including the `slice_overrides` shown
 * below — validated and then never read.
 *
 * The file is kept as a record of the request shape that is now refused, so an
 * integrator recognising their own code here can see exactly what was
 * withdrawn and why. Running it will print the refusal.
 */
import { PlotLiteClient } from '../../src/index.js';

async function main() {
  const client = new PlotLiteClient('http://localhost:3000');

  // Check limits first
  const limits = await client.getLimits();
  console.log('Service Limits:');
  console.log('  Max Nodes:', limits.max_nodes);
  console.log('  Max Edges:', limits.max_edges);
  console.log('  Max Payload:', limits.max_payload_bytes, 'bytes');
  console.log();

  // Run timeslices with priors and evidence
  const result = await client.runTimeslices({
    graph: {
      nodes: [
        { id: 'demand', label: 'Demand' },
        { id: 'revenue', label: 'Revenue' }
      ],
      edges: [
        { from: 'demand', to: 'revenue', weight: 0.9 }
      ]
    },
    timeslices: ['Q1_2024', 'Q2_2024', 'Q3_2024', 'Q4_2024'],
    slice_overrides: [
      {
        slice: 'Q2_2024',
        nodes: [{ id: 'demand', value: 1.2 }]
      }
    ],
    priors: {
      demand: 0.6
    },
    evidence: [
      {
        node_id: 'demand',
        source: 'historical_data_2023',
        weight: 0.8
      }
    ],
    seed: 4242
  });

  console.log('Timeslices Result:');
  console.log('  Schema:', result.schema);
  console.log('  Timeslices Count:', result.model_card.timeslices_count);
  console.log();

  result.results.forEach((r, i) => {
    console.log(`  Slice ${i + 1}: ${r.slice}`);
    console.log('    P10:', r.summary.p10);
    console.log('    P50:', r.summary.p50);
    console.log('    P90:', r.summary.p90);
    console.log('    Confidence:', r.confidence);
  });

  if (result.meta?.evidence_applied) {
    console.log();
    console.log('  Evidence Applied:');
    result.meta.evidence_applied.forEach((e, i) => {
      console.log(`    ${i + 1}. Node: ${e.node_id}, Source: ${e.source}, Weight: ${e.weight}`);
    });
  }
}

main().catch(console.error);
