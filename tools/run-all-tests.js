import { spawn } from 'child_process';
async function waitForHealth(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch('http://localhost:4311/health');
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
    // Start server in background
    const server = spawn('node', ['dist/server.js'], { stdio: 'inherit' });
    const healthy = await waitForHealth(5000);
    if (!healthy) {
        console.error('Server did not become healthy in time');
        server.kill('SIGINT');
        process.exit(1);
    }
    // Run vitest
    const vitestCode = await run('npx', ['vitest', 'run']);
    if (vitestCode !== 0) {
        server.kill('SIGINT');
        process.exit(vitestCode);
    }
    // Run fixtures replay
    const replayCode = await run('node', ['tools/replay-fixtures.js']);
    if (replayCode !== 0) {
        server.kill('SIGINT');
        process.exit(replayCode);
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
