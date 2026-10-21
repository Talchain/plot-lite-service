/**
 * TRACK 2 F2 (21 Oct 2026), PLoT → ISL half: the event-risk living models the CEE half wrote (F1_OUT) through PLoT's REAL
 * POST /v2/run and real ISL client to a REAL local ISL (F1_ISL_URL, `scripts/track2/run-chain.sh`). Nothing is mocked.
 * Analytic references (CEE fixture's docstring): points 0.9159 / 0.9732 (Olumi's σ = |β|/2 on severity and cost); exactly
 * stated, 0.900 / 0.970. Means £15,200 / £14,760 either way. Tolerance: 4 standard errors at n = 10,000.
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

const se = (p: number) => Math.sqrt(p * (1 - p) / 10_000);

describe('Track 2 F2: an event risk through PLoT and ISL gives the analytic chance of meeting £12,000', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    expect(process.env.ISL_BASE_URL, 'F1_ISL_URL must name a local ISL').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    app = await createServer({ logger: false } as never) as FastifyInstance;
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  async function run(name: string): Promise<any> {
    const file = join(OUT, `${name}.cee-to-plot.json`);
    expect(existsSync(file), `missing ${file}: run the CEE half first`).toBe(true);
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: JSON.parse(readFileSync(file, 'utf8')) });
    writeFileSync(join(OUT, `${name}.plot-response.json`), res.body);
    expect(res.statusCode, res.body.slice(0, 600)).toBe(200);
    return JSON.parse(res.body);
  }
  const option = (body: any, id: string) => (body.option_comparison ?? []).find((x: any) => x.option_id === id);

  it('POSITIVE CONTROL: the Batch 0 known answer gives push ≈ Φ(−1) = 0.1587 through the same chain', async () => {
    expect(option(await run('control'), 'push').probability_of_goal).toBeCloseTo(0.1587, 1);
  });

  it('points: Carry on 0.9159, Dual-source 0.9732 (the chance of meeting £12,000, never the win share); means £15,200 / £14,760', async () => {
    const body = await run('point');
    const warnings = (body.inference_warnings ?? []).map((w: any) => w.code).join(', ');
    // The outcome is on the goal's own frame: £ = value × the cap the request carries (absent when the goal is withheld).
    const sent = JSON.parse(readFileSync(join(OUT, 'point.cee-to-plot.json'), 'utf8'));
    const cap = (sent.graph.nodes as any[]).find((n) => n.id === sent.goal_node_id)?.goal_threshold_cap;
    for (const [id, p, mean] of [['status_quo', 0.9159, 15200], ['dual_source', 0.9732, 14760]] as const) {
      const o = option(body, id);
      expect.soft(o?.probability_of_goal, `${id} chance (warnings: ${warnings})`).toBeGreaterThanOrEqual(p - 4 * se(p));
      expect.soft(o?.probability_of_goal, `${id} chance`).toBeLessThanOrEqual(p + 4 * se(p));
      expect.soft(Math.abs(o?.outcome?.mean * cap - mean), `${id} mean £ (cap ${cap})`).toBeLessThanOrEqual(150);
    }
  });

  /**
   * No chance for either option, checked on options that EXIST and were computed, with PLoT's own reason (codex integration
   * review 7: the old loop passed on `{ option_comparison: [] }`, where every option is missing).
   */
  function expectNoChance(body: any): void {
    const ids = (body.option_comparison ?? []).map((o: any) => o.option_id).sort();
    expect(ids, 'each named option is in the response').toEqual(['dual_source', 'status_quo']);
    for (const id of ids) {
      expect(typeof option(body, id).outcome?.mean, `${id} was computed`).toBe('number');
      expect(option(body, id).probability_of_goal, id).toBeUndefined();
    }
    expect((body.inference_warnings ?? []).map((w: any) => w.code)).toContain('GOAL_THRESHOLD_NOT_CONVERTIBLE');
  }

  it('NEGATIVE: a floor Olumi still has to ask about (no keep/at-least cue, CEE #3540) gives no chance of meeting it', async () => {
    expectNoChance(await run('no-cue'));
  });

  it('the no-chance check is never vacuous: an empty or uncomputed response fails it', () => {
    expect(() => expectNoChance({ option_comparison: [] })).toThrow(/each named option/);
    expect(() => expectNoChance({ option_comparison: [{ option_id: 'status_quo' }, { option_id: 'dual_source' }] })).toThrow(/was computed/);
  });
});
