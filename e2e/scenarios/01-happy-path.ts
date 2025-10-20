import {Assert} from '../lib/assertions';
import {post, get} from '../lib/http';
export default async function(base = 'http://localhost:3000') {
  const a = new Assert();
  const h = await get(`${base}/v1/health`);
  a.eq('health 200', h.status, 200);
  const r = await post(`${base}/v1/run`, {graph: {nodes: [{id: 'A', label: 'A'}], edges: []}});
  a.eq('run 200', r.status, 200);
  return a;
}
