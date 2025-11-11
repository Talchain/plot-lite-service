/**
 * Shared Test Utilities
 * Robust helpers for lifecycle, timing, and server management
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let portCounter = 14000;
export function nextPort(): number {
  return portCounter++;
}

export interface WaitForOptions {
  timeout?: number;
  interval?: number;
  label?: string;
}

export async function waitFor<T>(
  fn: () => Promise<T> | T,
  opts: WaitForOptions = {}
): Promise<T> {
  const { timeout = 5000, interval = 100, label = 'condition' } = opts;
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      // Continue waiting on errors
    }
    await sleep(interval);
  }
  
  throw new Error(`waitFor(${label}) timed out after ${timeout}ms`);
}

export interface SpawnServerOptions {
  env?: Record<string, string>;
  port?: number;
  cwd?: string;
}

export interface ServerHandle {
  child: ChildProcess;
  port: number;
  baseUrl: string;
  kill: () => Promise<void>;
}

export async function spawnServer(opts: SpawnServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port || nextPort();
  
  // Unique TMPDIR per spawn to avoid collisions
  const tmpId = randomBytes(4).toString('hex');
  const tmpDir = join(process.env.TMPDIR || '/tmp', `plotlite-${tmpId}`);
  mkdirSync(tmpDir, { recursive: true });
  
  const baseEnv = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    USER: process.env.USER || '',
    TMPDIR: tmpDir,
    NODE_ENV: 'test',
    PORT: String(port),
    LOG_LEVEL: 'silent',
  };
  const env = { ...baseEnv, ...(opts?.env ?? {}) };
  
  const child = spawn('node', ['dist/main.js'], {
    env,
    cwd: opts.cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  const baseUrl = `http://127.0.0.1:${port}`;
  
  // Health probe with exponential backoff: 100ms, 200ms, 400ms, 800ms
  const delays = [100, 200, 400, 800];
  let ready = false;
  
  for (const delay of delays) {
    await sleep(delay);
    try {
      const res = await fetch(`${baseUrl}/v1/health`, { 
        signal: AbortSignal.timeout(500) 
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  
  if (!ready) {
    child.kill('SIGKILL');
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Server failed to start on port ${port} within 2000ms`);
  }
  
  const kill = async () => {
    if (child.pid) {
      child.kill('SIGTERM');
      await sleep(2000);
      try {
        process.kill(child.pid, 0);
        child.kill('SIGKILL');
      } catch {}
    }
    rmSync(tmpDir, { recursive: true, force: true });
  };
  
  return { child, port, baseUrl, kill };
}

export async function killTree(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
    await sleep(100);
    try {
      process.kill(pid, 0); // Check if still alive
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }
  } catch (err) {
    // Process may already be gone
  }
}

export async function requestJSON<T = any>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; data: T | null; headers: Headers }> {
  try {
    const res = await fetch(url, init);
    const headers = res.headers;
    let data: T | null = null;
    
    const contentType = headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        // Non-JSON response despite content-type
      }
    }
    
    return { status: res.status, data, headers };
  } catch (err) {
    throw new Error(`requestJSON failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface TestArtifactDir {
  path: string;
  cleanup: () => void;
}

export function createTestArtifactDir(prefix: string = 'test'): TestArtifactDir {
  const id = randomBytes(4).toString('hex');
  const path = join(process.cwd(), 'artifact', `${prefix}-${id}`);
  mkdirSync(path, { recursive: true });
  
  const cleanup = () => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  };
  
  return { path, cleanup };
}

export function writeTestConfig(dir: string, config: Record<string, any>): string {
  const path = join(dir, 'runtime-config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}
