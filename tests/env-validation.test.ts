import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

function startServerWithEnv(env: Record<string, string>): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(process.cwd(), 'dist/main.js')], {
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    // Kill after 2 seconds if still running
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 2000);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code, stdout, stderr });
    });
  });
}

describe('Environment Validation', () => {
  it('fails when AUTH_ENABLED=1 without AUTH_TOKEN', async () => {
    const result = await startServerWithEnv({
      AUTH_ENABLED: '1',
      AUTH_TOKEN: '', // Empty
      PORT: '4340',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('AUTH_ENABLED=1 requires AUTH_TOKEN');
  }, 10000);

  it('fails with invalid PORT', async () => {
    const result = await startServerWithEnv({
      PORT: 'invalid',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid PORT');
  }, 10000);

  it('fails with PORT out of range', async () => {
    const result = await startServerWithEnv({
      PORT: '99999',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid PORT');
  }, 10000);

  it('fails with invalid FASTIFY_REQUEST_TIMEOUT_MS', async () => {
    const result = await startServerWithEnv({
      FASTIFY_REQUEST_TIMEOUT_MS: '50', // Too low (must be >= 1000)
      PORT: '4341',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid FASTIFY_REQUEST_TIMEOUT_MS');
  }, 10000);

  it('fails with invalid RATE_LIMIT_RPM', async () => {
    const result = await startServerWithEnv({
      RATE_LIMIT_RPM: '0', // Too low
      PORT: '4342',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid RATE_LIMIT_RPM');
  }, 10000);

  it('fails with invalid CORS_ORIGINS', async () => {
    const result = await startServerWithEnv({
      CORS_ORIGINS: 'not-a-url,also-invalid',
      PORT: '4343',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid CORS_ORIGINS');
  }, 10000);

  it('succeeds with valid environment', async () => {
    const result = await startServerWithEnv({
      PORT: '4344',
      FASTIFY_REQUEST_TIMEOUT_MS: '180000',
      RATE_LIMIT_RPM: '60',
      CORS_ORIGINS: 'http://localhost:3000,https://example.com',
    });

    // Should start successfully (exit code 0 or still running)
    // If still running, it will be killed by timeout, which is fine
    expect([0, null]).toContain(result.exitCode);
  }, 10000);
});
