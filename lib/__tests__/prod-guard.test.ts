import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

function runNode(args: string[], env: Record<string,string> = {}): Promise<{ code: number, stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...env },
      shell: false,
    });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe('Production guard refuses to start with TEST_ROUTES=1', () => {
  it('prints exact line and exits non-zero', async () => {
    const mainPath = path.join(process.cwd(), 'dist', 'main.js');
    const { code, stderr } = await runNode([mainPath], { NODE_ENV: 'production', TEST_ROUTES: '1' });
    expect(code).not.toBe(0);
    expect(stderr.trim()).toContain('TEST_ROUTES in production – aborting');
  });
});
