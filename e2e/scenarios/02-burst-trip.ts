import {Assert} from '../lib/assertions';
import {post} from '../lib/http';
import {PrometheusClient} from '../lib/prometheus-client';
import {waitForMetric} from '../lib/prom-wait';

export default async function(base = 'http://localhost:3000') {
  const a = new Assert();
  const prom = new PrometheusClient();
  
  // Send burst to trip circuit
  const invalidGraph = {nodes: [], edges: []};
  for (let i = 0; i < 15; i++) {
    await post(`${base}/v1/run`, {graph: invalidGraph});
  }
  
  // Assert circuit opened with retries
  const opens = await waitForMetric(() => prom.val('plot_engine_circuit_open_total'));
  a.ok('circuit opened', (opens ?? 0) > 0, '> 0', opens ?? 0);
  
  return a;
}
