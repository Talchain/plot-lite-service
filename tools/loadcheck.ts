// @ts-ignore - types not installed for autocannon
import autocannon from 'autocannon';

async function main() {
  const url = 'http://localhost:4311/draft-flows';
  const body = JSON.stringify({ fixture_case: 'price-rise-15pct-enGB', seed: 1 });
  const result = await autocannon({ url, method: 'POST', headers: { 'content-type': 'application/json' }, body, connections: 10, pipelining: 1, duration: 5 });
  // @ts-ignore - result fields
  const p95 = (result.latency?.p95 ?? 0) as number;
  // @ts-ignore
  const max = (result.latency?.max ?? 0) as number;
  // @ts-ignore
  const rps = (result.requests?.average ?? result.requests?.mean ?? 0) as number;
  console.log(`Loadcheck p95_ms=${p95} max_ms=${max} rps=${rps}`);
}

main().catch((e) => { console.error('loadcheck failed', e); process.exit(1); });
