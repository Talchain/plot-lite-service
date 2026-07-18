/**
 * F3 (Codex) — flip-search deadline actually CANCELS in-flight probes.
 *
 * Before this cluster the `Date.now() >= deadline` guards in searchFlipForFactor
 * were checked only BETWEEN probes: they could not interrupt an awaited
 * Promise.allSettled, nor cancel a queued/in-flight probe. A probe that started
 * before the deadline ran to completion past it. The fix threads an AbortSignal
 * (factor + overall deadline) through the inference fn → callAnalysisEndpoint →
 * the client's fetch, so in-flight probes abort when the deadline trips.
 *
 * POSITIVE CONTROL (doctrine #13): the first test proves the harness can SEE the
 * un-cancelled case — a probe that IGNORES the signal keeps the search running
 * past the deadline (the deadline alone does NOT bound it). The second test then
 * proves that when probes honour the signal, the search returns within the bound
 * for 5 candidates and NO probe completes after the deadline.
 *
 * Mutation: revert the `factorSignal` threading in searchFlipForFactorInner (so
 * probes receive `undefined`) and the second test hangs → the 3s race cap trips →
 * RED. See the mutation transcript.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveFlipValues,
  type ISLInferenceFn,
  type FlipInferenceResult,
} from '../src/analysis/flip-thresholds.js';
import type { FlipThresholdInputData } from '../src/cee/validation/m1-review-types.js';

function makeCandidate(id: string): FlipThresholdInputData {
  return {
    factor_id: id,
    factor_label: id,
    current_value: 0.5,
    flip_value: null,
    direction: 'decrease',
    flip_reason: 'heuristic',
    iterations_used: 0,
  };
}

const FIVE = ['a', 'b', 'c', 'd', 'e'].map(makeCandidate);
const DEADLINE_MS = 200;

describe('flip-search cancellation on deadline (F3)', () => {
  it('POSITIVE CONTROL — a probe that IGNORES the signal keeps the search running past the deadline', async () => {
    // Never settles and never wires the abort listener → only real cancellation
    // could end it. If the deadline alone bounded in-flight probes, this would
    // return; it must not.
    const ignoreSignalMock: ISLInferenceFn = () =>
      new Promise<FlipInferenceResult>(() => { /* never settles, ignores signal */ });

    const outcome = await Promise.race([
      resolveFlipValues(FIVE, ignoreSignalMock, 'opt-a', {
        overallTimeoutMs: DEADLINE_MS,
        perFactorTimeoutMs: DEADLINE_MS,
      }).then(() => 'returned' as const),
      new Promise<'still-running'>((res) => setTimeout(() => res('still-running'), 600)),
    ]);

    expect(outcome).toBe('still-running');
  });

  it('FIX — honouring the signal cancels in-flight probes: returns within bound for 5 candidates, no late completion', async () => {
    const deadlineRef = { t: Date.now() + DEADLINE_MS };
    let lateCompletions = 0;

    // Honours the signal (rejects on abort); otherwise would resolve only after
    // 5s — far past the deadline. Any 5s resolution counts as a LATE completion.
    const signalAwareMock: ISLInferenceFn = (_factorId, _mean, signal) =>
      new Promise<FlipInferenceResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (Date.now() > deadlineRef.t) lateCompletions++;
          resolve({
            options: [
              { option_id: 'opt-a', win_probability: 0.6 },
              { option_id: 'opt-b', win_probability: 0.4 },
            ],
          });
        }, 5_000);
        const onAbort = () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); };
        if (signal?.aborted) { onAbort(); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
      });

    const start = Date.now();
    // Hard 3s cap so a cancellation regression FAILS FAST instead of hanging 5s.
    const { results } = (await Promise.race([
      resolveFlipValues(FIVE, signalAwareMock, 'opt-a', {
        overallTimeoutMs: DEADLINE_MS,
        perFactorTimeoutMs: DEADLINE_MS,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('flip search did not cancel within 3s')), 3_000)),
    ])) as { results: FlipThresholdInputData[] };
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3_000);          // returned via cancellation, not the 5s stall
    expect(results).toHaveLength(5);
    // Deadline-tripped factors are unresolved (null threshold) and disclosed.
    for (const r of results) {
      expect(r.flip_value).toBeNull();
      expect(r.flip_reason).toBe('timeout');
    }
    expect(lateCompletions).toBe(0);              // no probe completed AFTER the deadline
  }, 10_000);
});
