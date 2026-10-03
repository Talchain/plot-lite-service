/**
 * R1 S4 (B) — a STRICT goal ("MRR ABOVE £85k") reaches ISL as `goal_threshold_strict: true`.
 *
 * ISL #209 (R3 #72 5879133964): `true` → a draw exactly ON the threshold is NOT met (">", "<" when minimising);
 * absent/false → ">=" / "<=", byte-identical to before. A status quo held exactly at the target would otherwise score
 * 100% on a goal it has not reached. PLoT owns one hop: forward the producer's attestation VERBATIM.
 *
 * ⛔ THE GUARD IS NOT POLISH. ISL #209 refuses `goal_threshold_strict: true` with no `goal_threshold` — a 422 that
 * fails the WHOLE analysis — and PLoT's frame/domain safeguards can clear the threshold. So `true` is forwarded only
 * beside a threshold; otherwise the key is omitted and the user gets today's "at least" reading, disclosed as before.
 */

import { describe, it, expect } from 'vitest';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'lever', kind: 'factor', label: 'Price', observed_state: { value: 0.5, std: 0.1 } },
    { id: 'goal', kind: 'outcome', label: 'MRR' },
  ],
  edges: [
    { from: 'lever', to: 'goal', exists_probability: 0.95, strength: { mean: 0.6, std: 0.05 } },
  ],
} as unknown as EngineGraphV3;

const OPTIONS: OptionV3[] = [
  { id: 'opt_low', label: 'Hold price', interventions: { lever: { value: 0.2, source: 'user_specified' } } },
  { id: 'opt_high', label: 'Raise price', interventions: { lever: { value: 0.8, source: 'user_specified' } } },
] as unknown as OptionV3[];

function build(strict: boolean | undefined, threshold?: number) {
  return toISLRobustnessRequest(
    GRAPH, OPTIONS, 'goal', 'req-1',
    undefined, threshold, undefined, undefined, undefined,
    undefined, undefined, threshold === undefined ? undefined : 'level', undefined, 'maximise', strict,
  );
}

describe('goal_threshold_strict reaches the ISL wire', () => {
  it('forwards an attested strict goal beside its threshold', () => {
    const req = build(true, 0.85);
    expect(req.goal_threshold_strict).toBe(true);
    expect(req.goal_threshold).toBe(0.85);
  });

  // ⭐ Byte-identity when unattested: absent is not merely undefined, it is NOT PRESENT.
  it('omits the key entirely when unattested', () => {
    expect('goal_threshold_strict' in build(undefined, 0.85)).toBe(false);
  });

  it('omits the key when the producer says false (false is the historical reading, not a new fact)', () => {
    expect('goal_threshold_strict' in build(false, 0.85)).toBe(false);
  });

  it('the request is byte-identical to the unattested one when strict is false or absent', () => {
    expect(JSON.stringify(build(false, 0.85))).toBe(JSON.stringify(build(undefined, 0.85)));
  });
});

describe('true is never forwarded unsatisfiable (ISL #209 422s it without a threshold)', () => {
  it('drops strict when the request carries no goal_threshold', () => {
    const req = build(true, undefined);
    expect('goal_threshold' in req, 'PRECONDITION: no threshold on the request').toBe(false);
    expect('goal_threshold_strict' in req).toBe(false);
  });

  it('CONTROL: the same request with a threshold does carry it (the guard is specific, not a blanket drop)', () => {
    expect(build(true, 0.5).goal_threshold_strict).toBe(true);
  });
});
