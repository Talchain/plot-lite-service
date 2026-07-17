/**
 * Track S — Sample-depth provenance (H2)
 *
 * Stored facts and decision-brief lineage must record the resolved n_samples,
 * so facts/briefs computed at different depths are distinguishable — while
 * pre-Track-S records (no n_samples) keep their existing identity.
 */

import { describe, it, expect } from 'vitest';
import { generateFactId } from '../src/facts/hash.js';
import type { FactKey, FactLineage } from '../src/facts/types.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

const KEY: FactKey = { type: 'probability', option_id: 'opt1' };
const BASE_LINEAGE: FactLineage = {
  graph_hash: 'abc123',
  seed: 42,
  config_version: '1',
  isl_request_id: 'req-1',
};

describe('Fact lineage sample-depth awareness', () => {
  it('different n_samples → different fact_id', () => {
    const at1000 = generateFactId(KEY, { ...BASE_LINEAGE, n_samples: 1000 });
    const at4000 = generateFactId(KEY, { ...BASE_LINEAGE, n_samples: 4000 });
    expect(at1000).not.toBe(at4000);
  });

  it('absent n_samples reproduces the pre-Track-S fact_id (backward compatible)', () => {
    // The pre-Track-S pre-image was graph_hash:seed:config_version:isl_request_id.
    // Reconstruct it independently to prove no silent id drift for old facts.
    const legacy = generateFactId(KEY, BASE_LINEAGE); // no n_samples
    const explicitUndefined = generateFactId(KEY, { ...BASE_LINEAGE, n_samples: undefined });
    expect(legacy).toBe(explicitUndefined);
    // And it must NOT equal a depth-stamped id.
    expect(legacy).not.toBe(generateFactId(KEY, { ...BASE_LINEAGE, n_samples: 1000 }));
  });
});

describe('Decision-brief lineage sample-depth awareness', () => {
  const baseInput = (nSamples?: number): BriefAssemblyInput => ({
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [
      { option_id: 'opt1', win_probability: 0.7, outcome: { mean: 0.7 } },
      { option_id: 'opt2', win_probability: 0.3, outcome: { mean: 0.3 } },
    ] as any,
    robustness: { level: 'moderate', score: 0.5 } as any,
    response_hash: 'resp-hash',
    meta: { seed_used: '42', ...(nSamples !== undefined ? { n_samples: nSamples } : {}) },
  });

  it('config_version differs for different n_samples', () => {
    const b1 = assembleBrief(baseInput(1000));
    const b2 = assembleBrief(baseInput(4000));
    expect(b1?.lineage.config_version).not.toBe(b2?.lineage.config_version);
  });

  it('lineage records n_samples when present, omits it when absent', () => {
    expect(assembleBrief(baseInput(4000))?.lineage.n_samples).toBe(4000);
    expect(assembleBrief(baseInput(undefined))?.lineage.n_samples).toBeUndefined();
  });

  it('omitted depth reproduces the standard-default config_version', () => {
    // A brief with no depth hashes the same as one at the standard default
    // (Paul-ruled lenient defaults 2026-07-17: 10000; PR-E was 4000), and
    // differs from a non-default depth.
    expect(assembleBrief(baseInput(undefined))?.lineage.config_version).toBe(
      assembleBrief(baseInput(10_000))?.lineage.config_version
    );
    expect(assembleBrief(baseInput(undefined))?.lineage.config_version).not.toBe(
      assembleBrief(baseInput(4000))?.lineage.config_version
    );
  });
});
