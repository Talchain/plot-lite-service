// @ts-ignore - types not installed for autocannon
import autocannon from 'autocannon';
async function main() {
    const base = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:4311';
    const url = `${base.replace(/\/$/, '')}/draft-flows?template=pricing_change&seed=101`;
    const result = await autocannon({ url, method: 'GET', connections: 10, pipelining: 1, duration: 5 });
    // @ts-ignore - result fields
    const p95 = (result.latency?.p95 ?? 0);
    // @ts-ignore
    const max = (result.latency?.max ?? 0);
    // @ts-ignore
    const rps = (result.requests?.average ?? result.requests?.mean ?? 0);
    console.log(`Loadcheck p95_ms=${p95} max_ms=${max} rps=${rps}`);
}
main().catch((e) => { console.error('loadcheck failed', e); process.exit(1); });
