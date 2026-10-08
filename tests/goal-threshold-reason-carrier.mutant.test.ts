import { describe, expect, it } from 'vitest';
import { REASONS, refusal, useGoalThresholdHarness } from './helpers/goal-threshold-reason-carrier.js';

// Dedicated mutation witness: run against the source with the reason-carrier
// spread removed, then against restored source. Both use the real route.
describe('GOAL-REACH 3a — drop-reason-mapping mutation witness', () => {
  const run = useGoalThresholdHarness();
  it.each(REASONS)('detects dropping reason mapping for %s', async reason => {
    const { warnings } = await run([refusal({ reason })]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail?.reason).toBe(reason);
  });
});
