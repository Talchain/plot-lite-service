import { readFileSync } from 'fs';
import { resolve } from 'path';
async function main() {
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const text = readFileSync(fixturesPath, 'utf8');
    const fixtures = JSON.parse(text);
    const cases = fixtures.cases || [];
    let mismatches = 0;
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const reqBody = c.request;
        // Expected is the exact JSON string our server should emit
        const expected = JSON.stringify(c.response);
        const res = await fetch('http://localhost:4311/draft-flows', {
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
        process.exit(1);
    }
    else {
        console.log(`All fixtures match (${cases.length} case).`);
    }
}
main().catch((err) => {
    console.error('Error running replay-fixtures:', err);
    process.exit(1);
});
