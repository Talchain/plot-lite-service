import {Assert} from '../lib/assertions';
import {get} from '../lib/http';
export default async function(base = 'http://localhost:3000') {
  const a = new Assert();
  const h = await get(`${base}/v1/health`);
  a.eq('health 200', h.status, 200);
  a.ok('PE mode', h.json?.principal_extraction?.mode);
  return a;
}
