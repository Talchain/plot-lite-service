import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';

async function waitForHealth(timeoutMs = 5000, base = 'http://localhost:4311') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function run(cmd: string, args: string[], opts: any = {}): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function runCapture(cmd: string, args: string[], opts: any = {}): Promise<{ code: number, stdout: string, stderr: string }> {
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
  if (buildCode !== 0) process.exit(buildCode);

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
  } catch (e) {
    // ignore report errors
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
