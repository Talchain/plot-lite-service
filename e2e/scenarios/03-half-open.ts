import {Assert} from '../lib/assertions';
import {post} from '../lib/http';
export default async function(base = 'http://localhost:3000') {
  const a = new Assert();
  for (let i = 0; i < 15; i++) await post(`${base}/v1/run`, {graph: {nodes: [], edges: []}});
  await new Promise(r => setTimeout(r, 26000));
  const r = await post(`${base}/v1/run`, {graph: {nodes: [{id: 'A', label: 'A'}], edges: []}});
  a.ok('post-timeout', [200, 503].includes(r.status), '∈ {200,503}', r.status);
  return a;
}
