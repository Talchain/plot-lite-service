/**
 * Track 3 finding 1: the epistemic floor widened a STATED law.
 *
 * ⛔ THE DEFECT. The core mapper sizes a person's Normal link as {mean: value x ratio, std: sd x ratio}
 * (CEE `path-b/living-model/mapper.ts:301-302`, provenance.magnitude 'user_stated'). The causal floor
 * min(0.05, max(0.001, |mean|/2)) then lifted any stated sd under 0.05. Witnessed on local PLoT acf24764 +
 * ISL 8d862f5a (Track 3 runner, G4 Channel A): a declared sd 10 reached ISL as about 10.9, so P(goal) read
 * 0.178 against the exact 0.1587 (mu 90, target 100). The floor exists for Olumi's estimates; a stated
 * spread is the person's, and keeps only ISL's technical minimum (> 0.001).
 */
import { describe, expect, it } from 'vitest';
import { normaliseEdge, type NormalisationWarning } from '../src/normalisation/graph-normaliser.js';

const causal = new Map([['A', 'factor'], ['B', 'goal']]);
const run = (strength: { mean: number; std: number }, provenance?: Record<string, unknown>) => {
  const warnings: NormalisationWarning[] = [];
  const edge = normaliseEdge({ from: 'A', to: 'B', strength, ...(provenance ? { provenance } : {}) } as never, 0, causal, warnings);
  return { std: edge.strength.std, mean: edge.strength.mean, warnings };
};

describe('Track 3 finding 1: a stated spread is not lifted by the epistemic floor', () => {
  it('RED: a stated Normal link {0.1, 0.02} keeps 0.02 (was lifted to 0.05), with no CLAMP_STRENGTH_STD repair', () => {
    const r = run({ mean: 0.1, std: 0.02 }, { source: 'brief_extraction', magnitude: 'user_stated' });
    expect(r.mean).toBe(0.1);
    expect(r.std).toBe(0.02);
    expect(JSON.stringify(r.warnings)).not.toContain('CLAMP_STRENGTH_STD');
  });

  it('RED: the G4 shape, a stated exact-unit link {1, 0.0011}, reaches ISL at 0.0011, not 0.05', () => {
    expect(run({ mean: 1, std: 0.0011 }, { source: 'user_specified', magnitude: 'user_stated' }).std).toBe(0.0011);
  });

  it('CONTRAST: Olumi\'s estimate with the same numbers still floors to 0.05', () => {
    const r = run({ mean: 0.1, std: 0.02 }, { source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(r.std).toBe(0.05);
    expect(JSON.stringify(r.warnings)).toContain('CLAMP_STRENGTH_STD');
  });

  it('CONTRAST: no provenance floors exactly as before', () => {
    expect(run({ mean: 0.1, std: 0.02 }).std).toBe(0.05);
  });

  it('CONTRAST: the legacy source flag alone (no stated magnitude) floors exactly as before', () => {
    expect(run({ mean: 0.1, std: 0.02 }, { source: 'user_specified' }).std).toBe(0.05);
  });

  it('a stated spread below ISL\'s bound is lifted only to ISL\'s technical minimum, 0.0011', () => {
    expect(run({ mean: 0.1, std: 0.0002 }, { magnitude: 'user_stated' }).std).toBe(0.0011);
  });

  it('a stated spread above the floor is untouched either way: {0.4, 0.08} keeps 0.08', () => {
    expect(run({ mean: 0.4, std: 0.08 }, { magnitude: 'user_stated' }).std).toBe(0.08);
  });
});
