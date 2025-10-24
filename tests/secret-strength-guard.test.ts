/**
 * PR-F: Secret Strength Guard Test
 * Verifies that weak PRINCIPAL_HMAC_SECRET causes process exit
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

describe('Secret Strength Guard (PR-F)', () => {
  it('rejects weak secret (<64 chars) when breaker enabled', async () => {
    const testScript = `
      process.env.RL_CB_ENABLE = '1';
      process.env.PRINCIPAL_HMAC_SECRET = 'weak-secret'; // Only 11 chars
      
      // Import will trigger the guard
      import('./src/middleware/circuitBreaker.js');
    `;
    
    const proc = spawn('node', ['--input-type=module', '--eval', testScript], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        RL_CB_ENABLE: '1',
        PRINCIPAL_HMAC_SECRET: 'weak-secret',
      },
    });
    
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code || 0));
    });
    
    expect(exitCode).toBe(1);
    expect(stderr).toContain('PRINCIPAL_HMAC_SECRET');
    expect(stderr).toContain('must be ≥64 hex chars');
    expect(stderr).toContain('Current: 11 chars');
  }, 10000);

  it('accepts strong secret (≥64 chars) when breaker enabled', async () => {
    const strongSecret = 'a'.repeat(64); // 64 chars
    
    const testScript = `
      process.env.RL_CB_ENABLE = '1';
      process.env.PRINCIPAL_HMAC_SECRET = '${strongSecret}';
      
      // Import should succeed
      await import('./src/middleware/circuitBreaker.js');
      console.log('SUCCESS');
    `;
    
    const proc = spawn('node', ['--input-type=module', '--eval', testScript], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        RL_CB_ENABLE: '1',
        PRINCIPAL_HMAC_SECRET: strongSecret,
      },
    });
    
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code || 0));
    });
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain('SUCCESS');
  }, 10000);

  it('allows weak secret when breaker disabled', async () => {
    const testScript = `
      process.env.RL_CB_ENABLE = '0';
      process.env.PRINCIPAL_HMAC_SECRET = 'weak-secret';
      
      // Import should succeed (breaker disabled)
      await import('./src/middleware/circuitBreaker.js');
      console.log('SUCCESS');
    `;
    
    const proc = spawn('node', ['--input-type=module', '--eval', testScript], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        RL_CB_ENABLE: '0',
        PRINCIPAL_HMAC_SECRET: 'weak-secret',
      },
    });
    
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code || 0));
    });
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain('SUCCESS');
  }, 10000);
});
