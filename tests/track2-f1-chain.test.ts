/**
 * TRACK 2 F1 (21 Oct 2026), PLoT → ISL half: each CEE → PLoT request the CEE half wrote (F1_OUT) goes through PLoT's
 * REAL POST /v2/run and PLoT's real ISL client to a REAL local ISL (F1_ISL_URL, `track2/run-f1.sh`). Nothing is mocked.
 *
 * Analytic reference (the spec, Living Model Richness identity B): revenue is UK + EU customers × £40, nothing uncertain.
 * Carry on = £6,000 in every draw, never meets £6,500; Grow the UK = £6,800 in every draw, always meets. The coarse
 * model (total customers as the lever) must give the same. Each response is written beside its request.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.F1_OUT ?? '';
process.env.ISL_ENABLE = '1';
process.env.ISL_BASE_URL = process.env.F1_ISL_URL ?? '';
process.env.ISL_API_KEY = 'local-track2';

const { createServer } = await import('../src/createServer.js');

/** A pass-through spy: the exact body PLoT sends ISL for the current run (written beside its request). Nothing is altered. */
let islBody: string | undefined;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input).includes('/robustness/analyze/v2') && typeof init?.body === 'string') islBody = init.body;
  return realFetch(input, init);
}) as typeof fetch;

const ANALYTIC: Record<string, { revenue: number; meets: 0 | 1 }> = { hold: { revenue: 6000, meets: 0 }, grow_uk: { revenue: 6800, meets: 1 } };
/**
 * Float precision only. A stated part of a definition is held exact (PLoT `identityPartsHeldExact`): at CEE's minimum
 * stated-level spread, £40 drawn at σ £0.005 gave Grow the UK p10/p90 ±£0.13 and, against a £6,800 limit, 0.4955 where
 * it meets it (buddy r1). Before the identity was declared, the spread was ±£85 and the chance withheld.
 */
const FLOOR_GBP = 1e-6;

describe('Track 2 F1: a stated breakdown through PLoT and ISL gives the analytic answer, with no spread', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    expect(OUT, 'F1_OUT must name the CEE half\'s output folder').not.toBe('');
    expect(process.env.ISL_BASE_URL, 'F1_ISL_URL must name a local ISL').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    app = await createServer({ logger: false } as never) as FastifyInstance;
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  async function run(name: string): Promise<any> {
    const file = join(OUT, `${name}.cee-to-plot.json`);
    expect(existsSync(file), `missing ${file}: run the CEE half first`).toBe(true);
    islBody = undefined;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: JSON.parse(readFileSync(file, 'utf8')) });
    writeFileSync(join(OUT, `${name}.plot-response.json`), res.body);
    if (islBody !== undefined) writeFileSync(join(OUT, `${name}.plot-to-isl.json`), islBody);
    expect(res.statusCode, res.body.slice(0, 600)).toBe(200);
    return JSON.parse(res.body);
  }

  it('POSITIVE CONTROL: the Batch 0 known answer gives push ≈ Φ(−1) = 0.1587 and hold = 0 through the same chain', async () => {
    const body = await run('control');
    const o = (id: string) => (body.option_comparison ?? []).find((x: any) => x.option_id === id);
    expect(o('push'), JSON.stringify(body.option_comparison)?.slice(0, 1500)).toBeDefined();
    const chance = (x: any) => x.probability_of_goal;
    expect(chance(o('push')), `push keys ${Object.keys(o('push')).join(',')}`).toBeCloseTo(0.1587, 1);
    expect(chance(o('hold'))).toBe(0);
  });

  for (const name of ['fine', 'coarse', 'restated']) {
    it(`${name}: each option's revenue is the analytic figure in every draw, and its chance of £6,500 is 0 or 1`, async () => {
      const body = await run(name);
      const warnings = (body.inference_warnings ?? []).map((w: any) => w.code).join(', ');
      for (const [id, want] of Object.entries(ANALYTIC)) {
        const o = (body.option_comparison ?? []).find((x: any) => x.option_id === id);
        expect(o, `${id} missing from option_comparison`).toBeDefined();
        // Soft, so one RED run lists every gap. Revenue in £ per draw: the analytic figure at both ends, so no spread was
        // added by the breakdown; then the chance of meeting £6,500 (never the "comes out on top" share).
        expect.soft(Math.abs(o.outcome?.p10 - want.revenue), `${name} ${id} p10 £ (warnings: ${warnings})`).toBeLessThanOrEqual(FLOOR_GBP);
        expect.soft(Math.abs(o.outcome?.p90 - want.revenue), `${name} ${id} p90 £`).toBeLessThanOrEqual(FLOOR_GBP);
        expect.soft(o.probability_of_goal, `${name} ${id} chance of meeting £6,500`).toBe(want.meets);
      }
    });
  }

  it('at the limit: Grow the UK meets a £6,800 goal in every draw (chance 1, never ~50%); Carry on never does (0)', async () => {
    const body = await run('at-limit');
    const o = (id: string) => (body.option_comparison ?? []).find((x: any) => x.option_id === id);
    expect(o('grow_uk').probability_of_goal).toBe(1);
    expect(o('hold').probability_of_goal).toBe(0);
    expect(Math.abs(o('grow_uk').outcome.p10 - 6800)).toBeLessThanOrEqual(FLOOR_GBP);
  });

  it('NEGATIVE: a stated total that is not UK + EU (160 ≠ 150) never reaches a chance: CEE refuses it (no request sent)', () => {
    expect(existsSync(join(OUT, 'inconsistent.cee-to-plot.json'))).toBe(false);
    expect(existsSync(join(OUT, 'fine.cee-to-plot.json')), 'CONTROL: the CEE half wrote its other requests').toBe(true);
  });

  it('NEGATIVE CONTROL: a stated point cause into a part stays uncertain: P = Φ(0.75) ≈ 0.773, with a spread', async () => {
    const body = await run('stochastic');
    const spend = (body.option_comparison ?? []).find((x: any) => x.option_id === 'spend');
    expect(spend.probability_of_goal).toBeCloseTo(0.773, 1);
    expect(spend.outcome.p90 - spend.outcome.p10).toBeGreaterThan(100);
  });
});
