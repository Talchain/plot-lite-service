import { readFileSync } from 'fs';
import { resolve } from 'path';
async function main() {
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const text = readFileSync(fixturesPath, 'utf8');
    const fixtures = JSON.parse(text);
    const cases = fixtures.cases || [];
    let mismatches = 0;
    async function fetchWithRetry(url, init, attempts = 8, delayMs = 100) {
        let lastErr;
        for (let i = 0; i < attempts; i++) {
            try {
                return await fetch(url, init);
            } catch (e) {
                lastErr = e;
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
        throw lastErr;
    }
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const reqBody = { ...(c.request || {}), fixture_case: c.name };
        // Expected is the exact JSON string our server should emit
        const expected = JSON.stringify(c.response);
        const res = await fetchWithRetry(`${BASE}/draft-flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
        });
        const actual = await res.text();
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
        try {
            await fetch('http://localhost:4311/internal/replay-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'drift' }) });
        }
        catch { }
        process.exit(1);
    }
    else {
        console.log(`All fixtures match (${cases.length} case).`);
        try {
            await fetch('http://localhost:4311/internal/replay-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok', cases: cases.length }) });
        }
        catch { }
    }
}
main().catch((err) => {
    console.error('Error running replay-fixtures:', err);
    process.exit(1);
});
