import { describe, it, expect } from 'vitest';
import { waitFor } from '../utils.js';

/**
 * ROADMAP 2.879 — semantics pin for the shared `waitFor` helper.
 *
 * WHY THIS EXISTS. Spreading `@eslint/js`'s recommended set turned on
 * `no-async-promise-executor`, which surfaced the repo's only
 * `new Promise(async (resolve, reject) => …)` — a private `waitFor` inside
 * `tests/contracts.report.schema.test.ts`. That helper was DELETED rather than
 * reshaped: its ~45 siblings across `tests/` are already plain `async function`s,
 * and `tests/utils.ts` already exports a shared, general one that ~20 specs use.
 * The contracts test now calls the shared helper.
 *
 * That moves a behaviour the contracts test's `beforeAll` depends on behind a
 * module boundary, so it is pinned here. Nothing tested `waitFor` before, and
 * ~20 specs rely on it.
 *
 * THE ONE BEHAVIOUR THAT CHANGED, stated explicitly rather than left silent:
 * an async promise executor's rejection is dropped on the floor by the `Promise`
 * constructor, so any throw escaping the executor's inner `try` left the
 * returned promise PERMANENTLY UNSETTLED — a silent hang to the vitest timeout
 * with the real error lost. In the deleted helper the only rejecting `await`
 * (`fetch`) sat inside a `try/catch`, so no rejection was in fact being
 * swallowed on a reachable path; the hazard was latent, not live. It is now
 * structurally impossible, and case (4) pins that.
 *
 * Each case binds by IDENTITY (the exact sentinel value / the exact probe's
 * call count), never by a predicate another object could satisfy.
 */
describe('2.879 — shared waitFor semantics (the contract contracts.report.schema.test.ts depends on)', () => {
  it('resolves with the FIRST TRUTHY value, and does not settle on falsy polls', async () => {
    const READY = { sentinel: 'ready-value' };
    let calls = 0;
    const probe = () => {
      calls += 1;
      return calls < 3 ? false : READY;
    };

    const got = await waitFor(probe, { timeout: 2000, interval: 10, label: 'truthy' });

    // Identity, not shape: it must be the very object the probe returned.
    expect(got).toBe(READY);
    // It must have kept polling through the falsy returns, not resolved on the first.
    expect(calls).toBe(3);
  });

  it('SWALLOWS a throwing probe and keeps polling — the connection-refused case beforeAll relies on', async () => {
    const READY = { sentinel: 'up-at-last' };
    let calls = 0;
    const probe = async () => {
      calls += 1;
      // Stands in for `fetch` against a server that has not bound its port yet.
      if (calls < 3) throw new Error('ECONNREFUSED');
      return READY;
    };

    const got = await waitFor(probe, { timeout: 2000, interval: 10, label: 'throwing' });

    expect(got).toBe(READY);
    expect(calls).toBe(3);
  });

  it('REJECTS with a labelled timeout Error when the condition never becomes true', async () => {
    let calls = 0;
    const probe = () => {
      calls += 1;
      return false;
    };

    await expect(
      waitFor(probe, { timeout: 120, interval: 20, label: 'never-ready' }),
    ).rejects.toThrow(/waitFor\(never-ready\) timed out after 120ms/);

    // Pin the precondition: the rejection must come from the deadline being
    // reached after real polling, not from the probe never running at all.
    expect(calls).toBeGreaterThan(1);
  });

  it('SETTLES on the timeout path — it cannot hang, which an async promise executor could', async () => {
    // The defect `no-async-promise-executor` names: a promise that never
    // settles is indistinguishable from a slow one until the runner's own
    // timeout fires. Race the helper against a sentinel and require it to win.
    const outcome = await Promise.race([
      waitFor(() => false, { timeout: 150, interval: 25, label: 'settles' }).then(
        () => 'settled:resolved' as const,
        () => 'settled:rejected' as const,
      ),
      new Promise<'HUNG'>((resolve) => setTimeout(() => resolve('HUNG'), 3000)),
    ]);

    expect(outcome).toBe('settled:rejected');
  });
});
