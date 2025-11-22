import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

function runNode(args: string[], env: any = {}): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

describe('tools/replay.mjs', () => {
  it('validates a small NDJSON and reports zero errors', async () => {
    const file = resolvePath('fixtures', 'golden-seed-4242', 'stream.ndjson');
    const res = await runNode(['tools/replay.mjs', '--file', file]);
    expect(res.code).toBe(0);
    const j = JSON.parse(res.stdout.trim().split('\n').pop() || '{}');
    expect(j.errors).toBe(0);
    expect(typeof j.checksum_sha256).toBe('string');
  });
});
