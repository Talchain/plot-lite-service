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
    const RUN_REPLAY_STRICT = process.env.RUN_REPLAY_STRICT !== '0';
    // Start test server in background (enables test routes)
    const server = spawn('node', ['tools/test-server.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test', TEST_PORT: TEST_PORT, TEST_BASE_URL: TEST_BASE, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }
    });
    const healthy = await waitForHealth(5000, TEST_BASE);
    if (!healthy) {
        console.error('Server did not become healthy in time');
        server.kill('SIGINT');
        process.exit(1);
    }
    // settle window + triple health to avoid early accept backlog races
    await new Promise(r => setTimeout(r, 300));
    for (let i = 0; i < 3; i++) {
        await waitForHealth(1000, TEST_BASE);
    }
    // Run vitest with TEST_BASE_URL
    const vitestCode = await run('npx', ['vitest', 'run'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
    if (vitestCode !== 0) {
        server.kill('SIGINT');
        process.exit(vitestCode);
    }
    // Also generate a JSON report for CI artefacts
    try {
        mkdirSync('reports/warp', { recursive: true });
        const report = await runCapture('npx', ['vitest', 'run', '--reporter=json'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE, NODE_ENV: 'test' } });
        // Write regardless of exit code so we still capture failures
        writeFileSync(resolvePath('reports', 'tests.json'), report.stdout || '{}', 'utf8');
    }
    catch (e) {
        // ignore report errors
    }
    // Small settle delay before replay
    await new Promise((r) => setTimeout(r, 150));
    // Run fixtures replay (non-strict locally if RUN_REPLAY_STRICT=0)
    const replay = await runCapture('node', ['tools/replay-fixtures.js'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE } });
    if (replay.code !== 0) {
        if (RUN_REPLAY_STRICT) {
            server.kill('SIGINT');
            // Save artifact for CI
            try {
                writeFileSync(resolvePath('reports/warp', 'replay-last.json'), JSON.stringify({ base: TEST_BASE, code: replay.code, stderr: replay.stderr.slice(-2000), stdout: replay.stdout.slice(-2000) }, null, 2), 'utf8');
            }
            catch { }
            process.exit(replay.code);
        }
        else {
            console.warn('WARN: replay-fixtures failed (non-fatal in local dev).');
            try {
                writeFileSync(resolvePath('reports/warp', 'replay-last.json'), JSON.stringify({ base: TEST_BASE, code: replay.code, stderr: replay.stderr.slice(-2000), stdout: replay.stdout.slice(-2000) }, null, 2), 'utf8');
            }
            catch { }
        }
    }
    // OpenAPI lightweight validation (skips if spec missing)
    // Re-poll health briefly in case replay step triggered transient load
    await waitForHealth(2000, TEST_BASE);
    const openapiCode = await run('node', ['tools/validate-openapi-response.js'], { env: { ...process.env, TEST_BASE_URL: TEST_BASE } });
    // graceful shutdown and await close
    await new Promise((resolve) => { server.on('close', () => resolve()); server.kill('SIGINT'); });
    process.exit(openapiCode);
}
main().catch((err) => {
    console.error('Error running tests:', err);
    process.exit(1);
});
