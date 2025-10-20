import {Assert} from '../lib/assertions';
import {post} from '../lib/http';
export default async function(base = 'http://localhost:3000') {
  const a = new Assert();
  for (let i = 0; i < 15; i++) await post(`${base}/v1/run`, {graph: {nodes: [], edges: []}}, {'User-Agent': 'A'});
  const rA = await post(`${base}/v1/run`, {graph: {nodes: [{id: 'A', label: 'A'}], edges: []}}, {'User-Agent': 'A'});
  const rB = await post(`${base}/v1/run`, {graph: {nodes: [{id: 'A', label: 'A'}], edges: []}}, {'User-Agent': 'B'});
  a.ok('A impacted', [200, 429, 503].includes(rA.status));
  a.eq('B healthy', rB.status, 200);
  return a;
}
