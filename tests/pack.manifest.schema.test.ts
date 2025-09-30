import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runValidate(path: string): { code: number; out: string } {
  const r = spawnSync(process.execPath, ['tools/manifest-validate.mjs', path], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}

describe('Pack manifest schema validator', () => {
  it('accepts a minimal valid manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    const p = join(dir, 'manifest.json');
    const obj = {
      schema: 'pack.manifest.v1',
      created_utc: new Date().toISOString(),
      path: '/tmp/fake-pack',
      files: [ { path: 'engine/health.json', size_bytes: 123, sha256: 'deadbeef' } ],
    };
    writeFileSync(p, JSON.stringify(obj));
    const res = runValidate(p);
    expect(res.code).toBe(0);
  });

  it('rejects a malformed manifest (missing files)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    const p = join(dir, 'manifest.json');
    const obj = {
      schema: 'pack.manifest.v1',
      created_utc: new Date().toISOString(),
      path: '/tmp/fake-pack'
    } as any;
    writeFileSync(p, JSON.stringify(obj));
    const res = runValidate(p);
    expect(res.code).not.toBe(0);
  });
});
