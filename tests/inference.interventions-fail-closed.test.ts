/**
 * Fail-closed on discarded interventions (arch step 0, D-PLoT).
 *
 * ModelBasedInference.run() honours `config.interventions` ONLY on the
 * SCM-Lite branch (SCM_LITE_ENABLE=1). The fallback branch used to drop them
 * on the floor and return `simulateOutcome(...)` — a number with the shape,
 * units and plausibility of an interventional estimate, computed without ever
 * applying a single intervention. A caller cannot tell that apart from a real
 * answer.
 *
 * RED evidence (recorded before the fix, staging @ d27fe16):
 *   run(graph, { interventions: [{ node_id: 'A', value: 99 }], ... }) with
 *   SCM_LITE_ENABLE='0' returned
 *     { conservative: 93.48, most_likely: 98.4, optimistic: 103.32000000000001 }
 *   — byte-identical to the SAME call with no `interventions` key at all. That
 *   identity IS the defect: `do(A := 99)` on a node whose value is 0.4 moved
 *   nothing, because the intervention never reached the simulator. 7 of the 9
 *   assertions in this file failed on that tree.
 *
 * The control tests pin the OTHER half of the contract: requests carrying no
 * interventions must be completely unaffected. Their expected values are the
 * literals observed on the pre-change tree, so a regression in the fallback
 * simulator fails here rather than being absorbed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModelBasedInference } from '../src/inference/model_based.js';
import {
  CapabilityUnavailableError,
  isCapabilityUnavailableError,
} from '../src/inference/capability.js';
import type { Intervention } from '../src/scm-lite/types.js';

const graph = {
  nodes: [
    { id: 'A', label: 'A', value: 0.4 },
    { id: 'B', label: 'B', value: 0.6 },
  ],
  edges: [{ from: 'A', to: 'B', weight: 1.5, belief: 0.9 }],
};

const baseConfig = {
  seed: 4242,
  k_samples: 200,
  outcome_node: 'B',
  baseline_value: 100,
};

const interventions: Intervention[] = [{ node_id: 'A', value: 99 }];

describe('ModelBasedInference — fail closed when interventions cannot be applied', () => {
  const engine = new ModelBasedInference();
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.SCM_LITE_ENABLE;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SCM_LITE_ENABLE;
    else process.env.SCM_LITE_ENABLE = prev;
  });

  it('REFUSES (throws typed CapabilityUnavailableError) when interventions are supplied with SCM-Lite off', () => {
    process.env.SCM_LITE_ENABLE = '0';

    expect(() => engine.run(graph, { ...baseConfig, interventions })).toThrow(
      CapabilityUnavailableError
    );
  });

  it('the refusal carries the full typed contract: code, not_computed status, retryable=false, capability', () => {
    process.env.SCM_LITE_ENABLE = '0';

    let caught: unknown;
    try {
      engine.run(graph, { ...baseConfig, interventions });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isCapabilityUnavailableError(caught)).toBe(true);

    const e = caught as CapabilityUnavailableError;
    expect(e.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(e.status).toBe('not_computed');
    expect(e.retryable).toBe(false);
    expect(e.capability).toBe('interventional_inference');
    expect(e.reason).toContain('SCM_LITE_ENABLE');
  });

  it('refuses regardless of how many interventions are supplied (one is enough)', () => {
    process.env.SCM_LITE_ENABLE = '0';

    expect(() =>
      engine.run(graph, {
        ...baseConfig,
        interventions: [
          { node_id: 'A', value: 1 },
          { node_id: 'B', value: 2 },
        ],
      })
    ).toThrow(CapabilityUnavailableError);
  });

  it('refuses when the flag is unset entirely, not only when it is "0"', () => {
    delete process.env.SCM_LITE_ENABLE;

    expect(() => engine.run(graph, { ...baseConfig, interventions })).toThrow(
      CapabilityUnavailableError
    );
  });

  it('NEVER returns a number for an interventional request it cannot honour', () => {
    process.env.SCM_LITE_ENABLE = '0';

    let result: unknown;
    try {
      result = engine.run(graph, { ...baseConfig, interventions });
    } catch {
      result = undefined;
    }

    // The whole point: no plausible-looking outcome may escape this path.
    expect(result).toBeUndefined();
  });

  // ---- Controls: behaviour for requests carrying NO interventions is preserved ----

  it('CONTROL: a request with no interventions still computes, unchanged', () => {
    process.env.SCM_LITE_ENABLE = '0';

    const result = engine.run(graph, baseConfig);

    // Literals observed on the pre-change tree (d27fe16). If the guard had
    // altered the untouched path, these would move.
    expect(result.most_likely.outcome).toBeCloseTo(98.4, 10);
    expect(result.conservative.outcome).toBeCloseTo(93.48, 10);
    expect(result.optimistic.outcome).toBeCloseTo(103.32000000000001, 10);
  });

  it('CONTROL: an explicitly EMPTY interventions array computes — there is nothing to discard', () => {
    process.env.SCM_LITE_ENABLE = '0';

    const result = engine.run(graph, { ...baseConfig, interventions: [] });

    expect(result.most_likely.outcome).toBeCloseTo(98.4, 10);
    expect(result.conservative.outcome).toBeCloseTo(93.48, 10);
  });

  it('CONTROL: no-intervention output is byte-identical with and without the guard present', () => {
    process.env.SCM_LITE_ENABLE = '0';

    const withUndefined = engine.run(graph, { ...baseConfig, interventions: undefined });
    const withOmitted = engine.run(graph, baseConfig);
    const withEmpty = engine.run(graph, { ...baseConfig, interventions: [] });

    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(withOmitted));
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(withOmitted));
  });

  it('CONTROL: with SCM-Lite ON, interventions are honoured and no refusal is raised', () => {
    process.env.SCM_LITE_ENABLE = '1';

    const result = engine.run(graph, { ...baseConfig, interventions });

    expect(result).toBeDefined();
    expect(typeof result.most_likely.outcome).toBe('number');
    // SCM-Lite reports what it actually applied — the evidence the fallback
    // could never produce.
    expect(result.meta?.intervention_count).toBe(1);
  });
});
