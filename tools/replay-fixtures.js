import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fetchKA } from './http-keepalive.js';
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function expBackoff(attempt, base = 60, cap = 800) {
    const raw = Math.min(cap, base * Math.pow(2, attempt));
    return Math.floor(Math.random() * raw);
}
async function fetchWithRetry(url, init = {}, retries = 8) {
    let attempt = 0;
    for (;;) {
        try {
            const res = await fetchKA(url, init);
            if (!res.ok && res.status >= 500)
                throw new Error('server error');
            return res;
        }
        catch (e) {
            attempt++;
            if (attempt > retries)
                throw e;
            await sleep(expBackoff(attempt));
        }
    }
}
async function healthGate(base, neededOk = 3, maxTries = 30, intervalMs = 100) {
    let ok = 0, tries = 0;
    while (ok < neededOk && tries < maxTries) {
        tries++;
        try {
            const r = await fetchKA(`${base}/health`);
            if (r.ok)
                ok++;
            else
                ok = 0;
        }
        catch {
            ok = 0;
        }
        await sleep(intervalMs);
    }
    return ok >= neededOk;
}
async function main() {
    const base = process.env.TEST_BASE_URL || 'http://localhost:4311';
    // Health-gate before replay start
    await healthGate(base, 3, 30, 100);
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const text = readFileSync(fixturesPath, 'utf8');
    const fixtures = JSON.parse(text);
    const cases = fixtures.cases || [];
    let mismatches = 0;
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const reqBody = { ...(c.request || {}), fixture_case: c.name };
        // Expected is the exact JSON string our server should emit
        const expected = JSON.stringify(c.response);
        const res = await fetchWithRetry(`${base}/draft-flows`, {
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
            await fetchWithRetry(`${base}/internal/replay-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'drift' }) });
        }
        catch { }
        process.exit(1);
    }
    else {
        console.log(`All fixtures match (${cases.length} case).`);
        try {
            await fetchWithRetry(`${base}/internal/replay-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok', cases: cases.length }) });
        }
        catch { }
    }
    // Health-gate after replay finish to assert stability
    await healthGate(base, 3, 30, 100);
}
main().catch((err) => {
    console.error('Error running replay-fixtures:', err);
    process.exit(1);
});
