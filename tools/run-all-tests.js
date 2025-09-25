import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
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
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function retry(fn, { tries = 3, baseMs = 120, factor = 2 } = {}) {
    let attempt = 0, lastErr;
    while (attempt < tries) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            attempt++;
            if (attempt >= tries)
                break;
            const wait = baseMs * Math.pow(factor, attempt - 1);
            await sleep(wait);
        }
    }
    throw lastErr;
}
async function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
        p.on('close', (code) => resolve(code ?? 1));
    });
}
async function runCapture(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, ...opts });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => { out += d.toString(); });
        p.stderr.on('data', (d) => { err += d.toString(); });
        p.on('close', (code) => resolve({ code: code ?? 1, stdout: out, stderr: err }));
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
    // Run vitest with TEST_BASE_URL
    const vitestCode = await run('npx', ['vitest', 'run'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    if (vitestCode !== 0) {
        server.kill('SIGINT');
        process.exit(vitestCode);
    }
    // Also generate a JSON report for CI artefacts
    try {
        mkdirSync('reports', { recursive: true });
        const report = await runCapture('npx', ['vitest', 'run', '--reporter=json'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
        // Write regardless of exit code so we still capture failures
        writeFileSync(resolvePath('reports', 'tests.json'), report.stdout || '{}', 'utf8');
    }
    catch (e) {
        // ignore report errors
    }
    // Run fixtures replay with settle, health poll, retry, and local-only soft-fail
    await sleep(150);
    const healthyBeforeReplay = await waitForHealth(2000, TEST_BASE);
    const doReplayCapture = () => runCapture('node', ['tools/replay-fixtures.js'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    let replay = { code: 1, stdout: '', stderr: '' };
    try {
        replay = healthyBeforeReplay ? (await retry(doReplayCapture, { tries: 3, baseMs: 120, factor: 2 })) : (await doReplayCapture());
    }
    catch (e) {
        replay = { code: 1, stdout: '', stderr: String(e && e.message || e) };
    }
    if (replay.code !== 0) {
        try {
            const outDir = resolvePath('reports', 'warp');
            mkdirSync(outDir, { recursive: true });
            let health = null;
            try {
                const h = await fetch(`${TEST_BASE}/health`);
                const body = await h.text();
                health = { ok: h.ok, status: h.status, body };
            }
            catch (e) {
                health = { ok: false, error: String(e && e.message || e) };
            }
            const payload = { timestamp: new Date().toISOString(), base: TEST_BASE, replay, health, env: { CI: process.env.CI || '', NODE_ENV: process.env.NODE_ENV || '' } };
            writeFileSync(resolvePath('reports', 'warp', 'replay-last.json'), JSON.stringify(payload, null, 2), 'utf8');
        }
        catch { }
        const strict = String(process.env.CI) === '1' || String(process.env.RUN_REPLAY_STRICT) === '1';
        if (strict) {
            server.kill('SIGINT');
            process.exit(replay.code);
        }
        else {
            console.warn('WARN: replay-fixtures failed (non-fatal in local dev).');
        }
    }
    // OpenAPI lightweight validation (skips if spec missing)
    const openapiCode = await run('node', ['tools/validate-openapi-response.js']);
    server.kill('SIGINT');
    process.exit(openapiCode);
}
main().catch((err) => {
    console.error('Error running tests:', err);
    process.exit(1);
});
