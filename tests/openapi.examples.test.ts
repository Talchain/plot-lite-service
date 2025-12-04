import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type OA = any;

function hasErrorExample(resp: any): boolean {
  if (!resp || !resp.content) return false;
  for (const mt of Object.keys(resp.content)) {
    const ex = resp.content[mt]?.examples;
    if (ex && typeof ex === 'object') {
      for (const k of Object.keys(ex)) {
        const v = ex[k]?.value;
        if (v && v.schema === 'error.v1' && typeof v.code === 'string' && typeof v.message === 'string') return true;
      }
    }
  }
  return false;
}

describe('openapi error examples for v1', () => {
  it('every /v1/* route has at least one non-200 example using error.v1', () => {
    const render = spawnSync('node', [resolve(process.cwd(), 'tools', 'openapi-render.mjs')], { encoding: 'utf8', timeout: 8000 });
    expect(render.status).toBe(0);
    const out = resolve(process.cwd(), 'artifact', 'openapi.json');
    expect(existsSync(out)).toBe(true);
    const js: OA = JSON.parse(readFileSync(out, 'utf8'));
    const paths: Record<string, any> = js.paths || {};
    const v1Paths = Object.keys(paths).filter(p => p.startsWith('/v1/'));
    expect(v1Paths.length).toBeGreaterThan(0);

    const checked: string[] = [];
    for (const p of v1Paths) {
      const ops = paths[p] || {};
      let ok = false;
      for (const m of Object.keys(ops)) {
        const resps = ops[m]?.responses || {};
        for (const code of Object.keys(resps)) {
          if (code === '200' || code === '201' || code === '204') continue;
          if (hasErrorExample(resps[code])) { ok = true; break; }
        }
        if (ok) break;
      }
      if (ok) checked.push(p);
    }

    // Log which routes were checked (for visibility in CI output)
     
    console.log('checked v1 routes for examples:', checked.join(','));

    expect(checked.length).toBe(v1Paths.length);
  });
});
