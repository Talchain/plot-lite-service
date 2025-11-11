import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

describe('Startup HMAC Guard', () => {
  it('fails fast when TOKEN_HMAC_SECRET missing', async () => {
    // Remove test env vars so validation runs
    const env = { ...process.env };
    delete env.NODE_ENV;
    delete env.VITEST;
    delete env.TOKEN_HMAC_SECRET;
    
    const proc = spawn('node', ['dist/main.js'], { env });
    
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    
    const code = await new Promise<number>((resolve) => {
      proc.on('close', (c) => resolve(c || 0));
      setTimeout(() => { proc.kill(); resolve(1); }, 3000);
    });
    
    expect(code).toBe(1);
    expect(stderr).toContain('[FATAL] HMAC Secret Validation Failed');
    expect(stderr).toContain('TOKEN_HMAC_SECRET');
  }, 10000);

  it('starts successfully with valid secret', async () => {
    const env = { ...process.env };
    delete env.NODE_ENV;
    delete env.VITEST;
    env.TOKEN_HMAC_SECRET = 'a'.repeat(64);
    env.PORT = '0';  // Ephemeral port
    
    const proc = spawn('node', ['dist/main.js'], { env });
    
    let exited = false;
    let exitCode = 0;
    proc.on('close', (c) => { exited = true; exitCode = c || 0; });
    
    // Wait for startup
    await new Promise(r => setTimeout(r, 2000));
    
    // Kill gracefully
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    
    // Should not have exited with error during startup
    if (exited) {
      expect(exitCode).toBe(0);
    } else {
      // Still running = success
      expect(true).toBe(true);
    }
  }, 10000);
});
