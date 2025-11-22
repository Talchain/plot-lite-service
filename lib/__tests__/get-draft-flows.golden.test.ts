import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../../src/createServer.js';
import { ERR_MSG } from '../../src/lib/error-messages.js';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');
const templates = ['pricing_change', 'feature_launch', 'build_vs_buy'] as const;

type Case = { template: string, seed: number, abs: string };

async function collectFixtures(): Promise<Case[]> {
  const cases: Case[] = [];
  for (const tmpl of templates) {
    const dir = path.join(FIXTURES_DIR, tmpl);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter(f => /^\d+\.json$/.test(f));
    } catch {}
    for (const f of files) {
      const seed = Number(f.replace(/\.json$/, ''));
      cases.push({ template: tmpl, seed, abs: path.join(dir, f) });
    }
  }
  return cases;
}

describe('GET /draft-flows deterministic fixtures', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: true });
  });

  it('invalid template returns 404 and catalogue phrase', async () => {
    const res = await app.inject({ method: 'GET', url: '/draft-flows?template=__nope__&seed=101' });
    expect(res.statusCode).toBe(404);
    const j = res.json() as any;
    expect(j?.error?.type).toBe('BAD_INPUT');
    expect(j?.error?.message).toBe(ERR_MSG.INVALID_TEMPLATE);
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves pre-serialized bytes equal to on-disk fixture files', async () => {
    const cases = await collectFixtures();
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const url = `/draft-flows?template=${encodeURIComponent(c.template)}&seed=${c.seed}&budget=123`;
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['content-length']).toBeTruthy();
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['vary']).toContain('If-None-Match');
      const body = res.body; // string
      const fileText = await fs.readFile(c.abs, 'utf8');
      expect(body).toBe(fileText);
      const parsed = JSON.parse(body);
      expect(parsed?.schema).toBe('report.v1');
      expect(parsed?.meta?.fixtures_version).toBe('1.0.0');
      expect(parsed?.meta?.seed).toBe(c.seed);
      expect(parsed?.meta?.template).toBe(c.template);
    }
  });

  it('ETag round-trip returns 304 when If-None-Match matches', async () => {
    const c = (await collectFixtures())[0];
    const first = await app.inject({ method: 'GET', url: `/draft-flows?template=${c.template}&seed=${c.seed}` });
    expect(first.statusCode).toBe(200);
    const etag = first.headers['etag'];
    const second = await app.inject({ method: 'GET', url: `/draft-flows?template=${c.template}&seed=${c.seed}`, headers: { 'if-none-match': String(etag) } });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('400 vs 404 semantics for query validation', async () => {
    // Bad seed type -> 400 BAD_INPUT
    const badType = await app.inject({ method: 'GET', url: `/draft-flows?template=pricing_change&seed=notanint` });
    expect(badType.statusCode).toBe(400);
    const j1 = badType.json() as any;
    expect(j1?.error?.type).toBe('BAD_INPUT');
    expect(j1?.error?.fields?.seed).toBeDefined();

    // Unknown seed -> 404
    const unknownSeed = await app.inject({ method: 'GET', url: `/draft-flows?template=pricing_change&seed=999999` });
    expect(unknownSeed.statusCode).toBe(404);
    const j2 = unknownSeed.json() as any;
    expect(j2?.error?.type).toBe('BAD_INPUT');
  });
});
