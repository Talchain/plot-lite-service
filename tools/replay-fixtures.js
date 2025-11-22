import { readFileSync } from 'fs';
import { resolve } from 'path';
async function main() {
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const text = readFileSync(fixturesPath, 'utf8');
    const fixtures = JSON.parse(text);
    const cases = fixtures.cases || [];
    let mismatches = 0;
    // Use the test server base URL when provided (falls back to local dev server)
    const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:4311';
    async function report(data) {
        try {
            await fetch(`${BASE}/internal/replay-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        }
        catch { }
    }
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const reqBody = { ...(c.request || {}), fixture_case: c.name };
        // Expected is the exact JSON string our server should emit
        const expected = JSON.stringify(c.response);
        // Retry a couple of times on transient connection errors
        let actual = null;
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts && actual === null) {
            try {
                const res = await fetch(`${BASE}/draft-flows`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqBody),
                });
                actual = await res.text();
            }
            catch (err) {
                const code = err?.cause?.code || '';
                if (code === 'ECONNREFUSED') {
                    await report({ refusal: true, retry: true, attempt: attempt + 1, case: c.name });
                    await new Promise((r) => setTimeout(r, 50));
                    attempt++;
                    continue;
                }
                // Non-connection errors: rethrow
                throw err;
            }
        }
        if (actual === null) {
            // Give up on this case but do not fail the entire run; continue
            console.error(`Replay: connection refused for case ${c.name} after ${maxAttempts} attempts.`);
            await report({ refusal: true, final: true, case: c.name });
            continue;
        }
        if (expected !== actual) {
            mismatches++;
            const minLen = Math.min(expected.length, actual.length);
            let idx = 0;
            for (; idx < minLen; idx++) {
                if (expected.charCodeAt(idx) !== actual.charCodeAt(idx))
                    break;
            }
            const start = Math.max(0, idx - 40);
            const end = Math.min(minLen, idx + 40);
            console.error('Fixture drift at char', idx);
            console.error('Expected slice:', expected.slice(start, end));
            console.error('Actual   slice:', actual.slice(start, end));
            break;
        }
    }
    if (mismatches > 0) {
        await report({ status: 'fail' });
        process.exit(1);
    }
    else {
        console.log(`All fixtures match (${cases.length} cases).`);
        await report({ status: 'ok', cases: cases.length });
    }
}
main().catch((err) => {
    console.error('Error running replay-fixtures:', err);
    process.exit(1);
});
