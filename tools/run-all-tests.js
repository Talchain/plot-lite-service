import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
async function waitForHealth(timeoutMs = 5000, base = 'http://localhost:4311') {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${base}/health`);
            if (res.ok)
                return true;
        }
        catch { }
        await new Promise((r) => setTimeout(r, 150));
    }
    return false;
}
async function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
        p.on('close', (code) => resolve(code ?? 1));
    });
}
async function main() {
    // Ensure we are running the latest build
    const buildCode = await run('npm', ['run', 'build']);
    if (buildCode !== 0)
        process.exit(buildCode);
    // Pick a test port to avoid conflicts
    const TEST_PORT = process.env.TEST_PORT || '4313';
    const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;
    // Start test server in background (enables test routes)
    const server = spawn('node', ['tools/test-server.js'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', TEST_PORT: TEST_PORT, TEST_BASE_URL: TEST_BASE, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' } });
    const healthy = await waitForHealth(5000, TEST_BASE);
    if (!healthy) {
        console.error('Server did not become healthy in time');
        server.kill('SIGINT');
        process.exit(1);
    }
    // Run vitest ONCE with TEST_BASE_URL. The json reporter writes the CI artefact
    // (reports/tests.json, uploaded by release.yml) in the same run. Until 5 Oct 2026
    // a second full `vitest run --reporter=json` re-ran the whole suite (313-314 s on
    // CI) only to capture that file from stdout.
    mkdirSync('reports', { recursive: true });
    const vitestCode = await run('npx', ['vitest', 'run', '--reporter=basic', '--reporter=json', '--outputFile.json=reports/tests.json'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    if (vitestCode !== 0) {
        server.kill('SIGINT');
        process.exit(vitestCode);
    }
    // Run fixtures replay (target the same base URL as the test server)
    const replayCode = await run('node', ['tools/replay-fixtures.js'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    if (replayCode !== 0) {
        server.kill('SIGINT');
        process.exit(replayCode);
    }
    // OpenAPI lightweight validation (skips if spec missing)
    const openapiCode = await run('node', ['tools/validate-openapi-response.js'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    // Loadcheck gate (GET /draft-flows)
    const lc = await run('node', ['tools/loadcheck-wrap.cjs'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE }, });
    if (lc !== 0) {
        server.kill('SIGINT');
        process.exit(lc);
    }
    server.kill('SIGINT');
    process.exit(openapiCode);
}
main().catch((err) => {
    console.error('Error running tests:', err);
    process.exit(1);
});
