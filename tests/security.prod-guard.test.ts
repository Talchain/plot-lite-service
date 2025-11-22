import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

// Ensures main server refuses to start when TEST_ROUTES=1 with NODE_ENV=production
// Default runtime remains unchanged otherwise.

describe('Security: prod guard for test routes', () => {
  it('fails fast when TEST_ROUTES=1 and NODE_ENV=production', async () => {
    const p = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, NODE_ENV: 'production', TEST_ROUTES: '1', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = false;
    let code: number | null = null;
    await new Promise<void>((resolve) => {
      const to = setTimeout(() => resolve(), 2000);
      p.on('close', (c) => { exited = true; code = c; clearTimeout(to); resolve(); });
    });
    try { p.kill('SIGINT'); } catch {}
    expect(exited).toBe(true);
    expect(code).not.toBe(0);
  });
});
