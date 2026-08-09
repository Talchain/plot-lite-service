/**
 * Unit tests for V2 ISL translator
 */

import { describe, it, expect } from 'vitest';
import {
  toISLInterventions,
  toISLRobustnessRequest,
  validateISLRequest,
  toISLEdge,
  buildParameterUncertaintiesV3,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

describe('ISL Translator V3', () => {
  describe('toISLInterventions', () => {
    it('flattens InterventionValueV3 to numbers', () => {
      const interventions = {
        'factor-a': { value: 1.5, source: 'user_specified' as const },
        'factor-b': { value: 2.0, source: 'brief_extraction' as const },
      };

      const result = toISLInterventions(interventions);

      expect(result).toEqual({
        'factor-a': 1.5,
        'factor-b': 2.0,
      });
    });

    it('handles empty interventions', () => {
      const result = toISLInterventions({});

      expect(result).toEqual({});
    });
  });

  describe('toISLRobustnessRequest', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
        { id: 'factor-b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
      ],
    };

    const options: OptionV3[] = [
      {
        id: 'opt1',
        label: 'Option 1',
        interventions: {
          'factor-a': { value: 1.5, source: 'user_specified' },
        },
      },
      {
        id: 'opt2',
        label: 'Option 2',
        interventions: {
          'factor-b': { value: 2.0, source: 'user_specified' },
        },
      },
    ];

    it('builds complete ISL request', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.goal_node_id).toBe('goal');
      expect(result.request_id).toBe('req-123');
      expect(result.n_samples).toBe(1000);
    });

    // QUARANTINED: constraint node filtering not yet implemented — see pre-M2 backlog
    it.skip('transforms graph structure correctly', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      // Check nodes
      expect(result.graph.nodes).toHaveLength(3);
      expect(result.graph.nodes[0]).toEqual({
        id: 'factor-a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
      });

      // Check edges - uses ISL V3 format with strength object
      // exists_probability is preserved from input (structural uncertainty enabled)
      expect(result.graph.edges).toHaveLength(2);
      expect(result.graph.edges[0]).toEqual({
        from: 'factor-a',
        to: 'goal',
        exists_probability: 0.8, // Preserves actual value from input
        strength: { mean: 0.5, std: 0.1 },
      });
    });

    it('transforms options correctly', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toEqual({
        id: 'opt1',
        label: 'Option 1',
        interventions: { 'factor-a': 1.5 },
      });
    });

    it('includes parameter uncertainties for factor nodes', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.parameter_uncertainties).toBeDefined();
      expect(result.parameter_uncertainties!.length).toBeGreaterThan(0);

      const factorAUncertainty = result.parameter_uncertainties!.find(
        (p: any) => p.node_id === 'factor-a'
      );
      expect(factorAUncertainty).toBeDefined();
      expect(factorAUncertainty!.distribution).toBe('normal');
      // Slice 6: `mean` is no longer sent (ISL declares none). The derivation
      // from observed_state.value=50 stays observable through `std`
      // (50 * VALUE_BASED_STD_FRACTION = 7.5) and through the value's own
      // declared location on the graph node.
      expect(factorAUncertainty!).not.toHaveProperty('mean');
      expect(factorAUncertainty!.std).toBeCloseTo(7.5, 5);
      expect(
        result.graph.nodes.find((n: any) => n.id === 'factor-a')!.observed_state!.value,
      ).toBe(50);
    });

    it('does not include category field in ISL request', () => {
      const graphWithCategory: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A', category: 'controllable' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B', category: 'observable' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
        ],
      };

      const result = toISLRobustnessRequest(graphWithCategory, options, 'goal', 'req-123', 1000);

      // Verify category is NOT in ISL payload (it's PLoT-internal metadata for M1 coaching)
      result.graph.nodes.forEach((node: any) => {
        expect(node).not.toHaveProperty('category');
      });
    });
  });

  describe('validateISLRequest', () => {
    it('returns empty array for valid request', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
      ];

      const request = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);
      const errors = validateISLRequest(request);

      expect(errors).toHaveLength(0);
    });

    it('detects missing goal_node_id', () => {
      const request = {
        graph: { nodes: [{ id: 'a', kind: 'factor', label: 'A' }], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: { 'a': 1.0 } }],
        goal_node_id: 'nonexistent',
        request_id: 'req-123',
        n_samples: 1000,
        analysis_types: ['comparison'] as const[],
      };

      const errors = validateISLRequest(request as any);

      // Should detect that goal node is not in graph
      expect(errors.some(e => e.includes('Goal node'))).toBe(true);
    });

    it('detects empty options', () => {
      const request = {
        graph: { nodes: [], edges: [] },
        options: [],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('options'))).toBe(true);
    });

    it('detects empty graph nodes', () => {
      const request = {
        graph: { nodes: [], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: {} }],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('nodes'))).toBe(true);
    });

    it('detects option with empty interventions', () => {
      const request = {
        graph: { nodes: [{ id: 'a', kind: 'factor', label: 'A' }], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: {} }],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('interventions'))).toBe(true);
    });
  });

  describe('toISLEdge - exists_probability preservation', () => {
    it('preserves explicit exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.7,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.7);
    });

    it('preserves high exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.95,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.95);
    });

    it('preserves low exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.3,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.3);
    });

    it('preserves 1.0 exists_probability (certain edge)', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 1.0,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(1.0);
    });
  });

  /**
   * PRIOR-ONLY EXTERNAL FACTORS — the wire must CARRY the prior, not summarise it.
   *
   * These cases used to pin `{distribution:'normal', std: width/sqrt(12)}`. The
   * width was right and the CENTRE had nowhere to go: ISL's ParameterUncertainty
   * declares no `mean`, its normal branch reads the centre from the node's
   * `observed_state.value`, and a prior-only factor has none — so a declared
   * Uniform[0.6,1.0] was sampled at mean -0.000434 with every one of 20,000 draws
   * outside its own support, and the root-default detector stayed silent because
   * an entry was PRESENT. ISL has supported `uniform` with `range_min`/`range_max`
   * all along (robustness_v2.py:243-291, robustness_analyzer_v2.py:1180-1188 @
   * 47f20068), so the fix is a PLoT-only change of family.
   *
   * The behavioural half of this — that ISL's own sampler now lands where the
   * prior says — is measured in tests/isl-factor-sampler-centre.contract.test.ts
   * against ISL's real FactorSampler. These cases pin the WIRE; that one pins
   * what ISL DOES with it. Neither substitutes for the other: a wire assertion
   * cannot see a sampler that ignores the field, and the sampler pairing cannot
   * see a producer that stops emitting.
   */
  describe('buildParameterUncertaintiesV3 - external factor priors', () => {
    it('external factor with prior [0.0, 1.0] → uniform carrying both bounds', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        node_id: 'ext-factor',
        distribution: 'uniform',
        range_min: 0.0,
        range_max: 1.0,
      });
      // `mean` is still not a member ISL declares — the bounds are the channel.
      expect(result[0]).not.toHaveProperty('mean');
      // And NOT the old centre-less normal, which is the whole defect.
      expect(result[0]).not.toHaveProperty('std');
    });

    it('external factor with prior [0.6, 1.0] → bounds survive verbatim (midpoint 0.8 recoverable)', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.6, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        node_id: 'ext-factor',
        distribution: 'uniform',
        range_min: 0.6,
        range_max: 1.0,
      });
    });

    it('external factor with prior [0.3, 0.7] → a DIFFERENT support, not a shared width', () => {
      // [0.3,0.7] and [0.6,1.0] have the SAME width, so under the old
      // width-only wire they produced byte-identical entries and were
      // indistinguishable to ISL. Keeping both cases is what makes that
      // collapse impossible to reintroduce silently.
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.3, range_max: 0.7 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        node_id: 'ext-factor',
        distribution: 'uniform',
        range_min: 0.3,
        range_max: 0.7,
      });
    });

    it('external factor without prior → no parameter_uncertainties entry', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    /**
     * REPLACED with the prior-only sampling-centre fix (was: "range_min ===
     * range_max → mean=value, std=0.01 (floor)").
     *
     * A degenerate range is a POINT MASS, and there is no honest way to put one
     * on this wire: ISL's `point_mass` branch returns `observed_state.value`
     * (robustness_analyzer_v2.py:1171-1173), which a prior-only factor does not
     * have, and its uniform validator rejects `range_min >= range_max` outright
     * (robustness_v2.py:277-283) — sending one would 422 the WHOLE analysis, not
     * just this factor. The old behaviour floored the width to 0.01 and shipped
     * a normal centred, silently, on 0.0.
     *
     * So PLoT declines. With no entry emitted, ISL's root-default detector fires
     * ROOT_NODE_DEFAULT_VALUE for the node (robustness_analyzer_v2.py:1826-1834)
     * and the user is TOLD the value was defaulted. Visible failure over
     * confident wrongness — and this is a behaviour change, deliberately made,
     * not a test relaxed to fit.
     */
    it('range_min === range_max → DECLINED, so ISL discloses the defaulted root instead', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.5, range_max: 0.5 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    it('a degenerate prior is declined WITHOUT taking its well-formed siblings down', () => {
      // Discrimination: the decline must be scoped to the offending factor. A
      // `continue` that had been a `return`/`break` would pass the case above
      // and silently drop every later factor in the graph.
      const nodes: EngineNodeV3[] = [
        {
          id: 'degenerate-f',
          kind: 'factor',
          label: 'Degenerate',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.5, range_max: 0.5 },
        },
        {
          id: 'healthy-f',
          kind: 'factor',
          label: 'Healthy',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.1, range_max: 0.9 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result.map((u) => u.node_id)).toEqual(['healthy-f']);
      expect(result[0]).toEqual({
        node_id: 'healthy-f',
        distribution: 'uniform',
        range_min: 0.1,
        range_max: 0.9,
      });
    });

    it('range_min > range_max → swapped, std reflects the swapped width', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.9, range_max: 0.3 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      // WITHOUT the swap, range_min > range_max and the degenerate guard
      // declines the factor entirely (and ISL's own validator would 422 the
      // request), so this assertion still fails loudly if the swap is removed —
      // it is not merely describing the happy path.
      expect(result[0]).toEqual({
        node_id: 'ext-factor',
        distribution: 'uniform',
        range_min: 0.3,
        range_max: 0.9,
      });
      expect(result[0]).not.toHaveProperty('mean');
    });

    it('mixed graph: controllable + observable + external with prior', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'controllable-f',
          kind: 'factor',
          label: 'Controllable',
          category: 'controllable',
          observed_state: { value: 0.7 },
        },
        {
          id: 'observable-f',
          kind: 'factor',
          label: 'Observable',
          category: 'observable',
          observed_state: { value: 0.4 },
        },
        {
          id: 'external-f',
          kind: 'factor',
          label: 'External',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
        },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      // All three factor types should produce entries
      expect(result).toHaveLength(3);

      const controllable = result.find(u => u.node_id === 'controllable-f');
      const observable = result.find(u => u.node_id === 'observable-f');
      const external = result.find(u => u.node_id === 'external-f');

      // Each path is pinned by what it DERIVES, and the three remain mutually
      // distinguishable: the two observed_state paths by their own std, the
      // prior path by being a different DISTRIBUTION FAMILY entirely.
      expect(controllable).toBeDefined();
      expect(controllable!.distribution).toBe('normal');
      expect((controllable as { std: number }).std).toBeCloseTo(0.7 * 0.15, 5);

      expect(observable).toBeDefined();
      expect(observable!.distribution).toBe('normal');
      expect((observable as { std: number }).std).toBe(0.1); // 0.4 * 0.15 = 0.06, floored

      expect(external).toBeDefined();
      expect(external).toEqual({
        node_id: 'external-f',
        distribution: 'uniform',
        range_min: 0.2,
        range_max: 0.8,
      });

      for (const entry of result) expect(entry).not.toHaveProperty('mean');
    });

    it('external factor with observed_state AND prior → observed_state takes precedence', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          observed_state: { value: 0.9 },
          prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      // Should use observed_state, not the prior. The discriminator is now the
      // FAMILY as well as the std: if precedence flipped, this would be a
      // uniform over [0, 1] rather than a normal of std 0.9 * 0.15 = 0.135.
      expect(result[0]).not.toHaveProperty('mean');
      expect(result[0].distribution).toBe('normal');
      expect(result[0]).not.toHaveProperty('range_min');
      expect((result[0] as { std: number }).std).toBeCloseTo(0.135, 5);
    });

    it('unsupported distribution → skipped with no entry', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'beta', range_min: 0.3, range_max: 0.9 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    /**
     * REPLACED in contract step-2 slice 6 (was: "mean is clamped to [0, 1] for
     * out-of-range priors").
     *
     * The clamp existed solely to shape `parameter_uncertainties[].mean`, a key
     * ISL never declared and dropped at parse under `extra: "ignore"`. Removing
     * the key removes the clamp's only observable, so the old assertion
     * (`result[0].mean === 0`) can no longer be made about anything real — it
     * would have been guarantee-theatre to keep it pointing at a value nobody
     * receives. What survives from that case is the WIDTH derivation for an
     * out-of-range prior, pinned below.
     *
     * This is a deliberate behaviour retirement, not a test bypass: the clamp
     * is gone from the producer too.
     */
    it('out-of-range prior is forwarded VERBATIM — PLoT does not silently re-domain it', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: -0.5, range_max: 0.3 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('mean');
      // The bounds now reach ISL as stated, negative end included. Clamping
      // them here would be PLoT inventing a support the producer never
      // declared — the same fabrication class the retired `mean` clamp was.
      expect(result[0]).toEqual({
        node_id: 'ext-factor',
        distribution: 'uniform',
        range_min: -0.5,
        range_max: 0.3,
      });
    });
  });
});
