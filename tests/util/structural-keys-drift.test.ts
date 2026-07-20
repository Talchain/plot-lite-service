/**
 * Drift guard for src/util/structural-keys.generated.ts (Wave1-L1 review-3).
 *
 * redactPayloadShape preserves CONTRACT-DEFINED object keys and digests
 * DATA-DERIVED ones. That set is generated from the contract type declarations
 * (tools/gen-structural-keys.mjs) rather than hand-listed, so it cannot rot
 * into an ad-hoc denylist as the contract evolves.
 *
 * This test fails if someone edits a contract type without regenerating —
 * which would otherwise silently start digesting a structural key (shape
 * damage) with no signal.
 */

import { describe, it, expect } from 'vitest';

describe('structural-keys.generated.ts tracks the contract types', () => {
  it('is up to date with the contract type declarations', async () => {
    // Codex F6: use the generator's PURE checkRegistry(). The old version's
    // import of the generator RAN its top-level write, silently regenerating
    // the registry before the comparison — so this test passed over a stale
    // committed file and could never fail. The generator is now
    // side-effect-free on import (writes only under direct CLI invocation).
    const gen = await import('../../tools/gen-structural-keys.mjs');
    const { ok, expected, actual } = gen.checkRegistry();
    // If this fails: node tools/gen-structural-keys.mjs
    expect(actual).toBe(expected);
    expect(ok).toBe(true);
  });

  it('covers the ISL wire keys the echoed payload depends on', async () => {
    const { STRUCTURAL_KEYS } = await import('../../src/util/structural-keys.generated.js');
    // Spot-check the shape a debugger navigates on downstream_calls.isl[].
    for (const k of ['graph', 'nodes', 'edges', 'options', 'interventions', 'id', 'label', 'mean', 'std', 'goal_node_id', 'analysis_status']) {
      expect(STRUCTURAL_KEYS.has(k)).toBe(true);
    }
  });

  it('does NOT cover data-derived node-id slugs', async () => {
    const { STRUCTURAL_KEYS } = await import('../../src/util/structural-keys.generated.js');
    // The residual: these are `interventions` KEYS in production traffic.
    for (const k of ['acquire-fintechco-for-50m', 'factor-0', 'zqxpii-marker-node']) {
      expect(STRUCTURAL_KEYS.has(k)).toBe(false);
    }
  });
});
