import { describe, expect, it } from 'vitest';
import { goalIdentityWithheldMessage } from '../src/lib/goal-identity-withhold.js';

/**
 * The #416 family's opening "Not shown." is a CONTRACT with the consumers that read PLoT's words (R3, 29 Sep; served UI
 * `106ac7f5`, CEE `3577ee2`, PLoT `d4bcf32`):
 * - the UI shows the words only when they start "Not shown." — DGAI `src/components/results/utils/goalIdentityWithheld.ts`
 *   (`raw.startsWith('Not shown.')`, ≤ 400 chars, no snake_case or brackets), else its "couldn't calculate…" fallback;
 * - CEE strips `/^Not shown\.\s*\/` before the Agent says the reason (`orchestrator-v5/agent-lane/goal-chance-withheld.ts`,
 *   `orchestrator-v5/context/context-pack-assembler.ts`).
 * #420's no-card words opened "Not shown:", so on every served unconfirmed run the Goal panel and Reasoning tab said
 * "couldn't calculate one of the formulas…" while the chat said "hasn't been confirmed". The copies below are verbatim.
 */
const uiShows = (raw: string): boolean =>
  raw.startsWith('Not shown.') && raw.length <= 400 && !/\b[a-z0-9]+_[a-z0-9_]+\b|[{}[\]<>]/.test(raw);
const ceeReason = (raw: string): string => raw.replace(/^Not shown\.\s*/, '').trim();

const MRR = { node_id: 'mrr', label: 'MRR', parts: ['Pro plan price', 'Paying subscribers'], operation: 'product' as const };
const CARRIER = { node_id: 'pro_plan_mrr', label: 'Pro plan MRR', parts: ['Pro plan price', 'Pro paying subscribers'], operation: 'product' as const };

describe('the "Not shown." opener — the UI and CEE read PLoT\'s withheld words by it', () => {
  it.each([
    ['unconfirmed, on the goal (variant (d))', [MRR], new Set(['mrr']), undefined],
    ['unconfirmed, on a carrier, naming the goal\'s target', [CARRIER], new Set(['pro_plan_mrr']), 'MRR'],
    ['unconfirmed, several identities ("and 1 more")', [MRR, CARRIER], new Set(['mrr']), undefined],
    ['not evaluated (#416\'s own words)', [MRR], new Set<string>(), undefined],
  ])('%s: the UI shows PLoT\'s words, and CEE strips only the opener', (_label, nodes, unconfirmed, goalLabel) => {
    const words = goalIdentityWithheldMessage(nodes, unconfirmed, goalLabel);
    expect(uiShows(words)).toBe(true);
    const reason = ceeReason(words);
    expect(reason).not.toBe(words);
    expect(reason).not.toMatch(/^Not shown/);
  });

  it('the unconfirmed words keep their meaning after the opener (AIQ 5891608873)', () => {
    expect(goalIdentityWithheldMessage([MRR], new Set(['mrr']))).toBe(
      "Not shown. Olumi reads 'MRR' as 'Pro plan price' × 'Paying subscribers', but that hasn't been confirmed, so this run gives no chance of reaching the target for 'MRR'.",
    );
  });
});
