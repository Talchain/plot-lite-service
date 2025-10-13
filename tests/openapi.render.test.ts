import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('openapi render', () => {
  it('renders artifact/openapi.json with matching top-level paths', async () => {
    const render = spawnSync('node', [resolve(process.cwd(), 'tools', 'openapi-render.mjs')], { encoding: 'utf8', timeout: 8000 });
    expect(render.status).toBe(0);
    const out = resolve(process.cwd(), 'artifact', 'openapi.json');
    expect(existsSync(out)).toBe(true);
    const txt = readFileSync(out, 'utf8');
    const js = JSON.parse(txt);
    expect(js && typeof js === 'object').toBe(true);
    const paths = js.paths || {};
    const keys = Object.keys(paths);
    expect(keys.includes('/v1/stream')).toBe(true);
    expect(keys.includes('/v1/run')).toBe(true);
  });
});
