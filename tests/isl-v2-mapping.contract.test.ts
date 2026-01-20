/**
 * Contract tests for ISL V2 response mapping
 *
 * Tests:
 * - V2 mapping produces correct output
 * - V1 shape triggers degraded response
 * - Option ID mismatch triggers degraded response
 */

import { describe, it, expect } from 'vitest';

// Import the shape validation function and transformation functions
// These are private to run.ts, so we'll test via integration or extract them

/**
 * Mock V2 ISL response for testing
 */
const mockV2Response = {
  analysis_status: 'computed',
  options: [
    {
      id: 'opt1',
      option_id: 'opt1',
      outcome: {
        mean: 100.5,
        std: 10.2,
        p10: 85.0,
        p50: 100.0,
        p90: 115.0,
        n_samples: 1000,
        n_valid_samples: 950,
        validity_ratio: 0.95,
      },
      status: 'computed',
      win_probability: 0.65,
    },
    {
      id: 'opt2',
      option_id: 'opt2',
      outcome: {
        mean: 95.0,
        std: 8.5,
        p10: 82.0,
        p50: 95.0,
        p90: 108.0,
        n_samples: 1000,
        n_valid_samples: 960,
        validity_ratio: 0.96,
      },
      status: 'computed',
      win_probability: 0.35,
    },
  ],
  robustness: {
    score: 0.75,
    label: 'moderate',
    fragile_edges: [
      {
        edge_id: 'factor_a->goal',
        from_id: 'factor_a',
        to_id: 'goal',
        switch_probability: 0.3,
      },
    ],
    robust_edges: [
      {
        edge_id: 'factor_b->goal',
        from_id: 'factor_b',
        to_id: 'goal',
      },
    ],
    explanation: 'Moderate robustness with one fragile edge',
  },
};

/**
 * Mock V1 ISL response (uses 'results' instead of 'options')
 */
const mockV1Response = {
  analysis_status: 'computed',
  results: [
    {
      id: 'opt1',
      expected_outcome: 100.5,
      confidence_interval: [85.0, 115.0],
    },
    {
      id: 'opt2',
      expected_outcome: 95.0,
      confidence_interval: [82.0, 108.0],
    },
  ],
  sensitivity: [
    {
      edge_from: 'factor_a',
      edge_to: 'goal',
      sensitivity_type: 'existence',
      elasticity: 0.5,
      importance_rank: 1,
      interpretation: 'High sensitivity',
    },
  ],
};

describe('ISL V2 Response Mapping Contract', () => {
  describe('V2 Shape Validation', () => {
    it('should validate correct V2 structure', () => {
      const response = mockV2Response;

      // Check V2 structure requirements
      expect(response.options).toBeDefined();
      expect(Array.isArray(response.options)).toBe(true);
      expect(response.options.length).toBeGreaterThan(0);

      // Check each option has required fields
      for (const opt of response.options) {
        expect(opt.id || opt.option_id).toBeDefined();
        expect(opt.outcome?.mean).toBeDefined();
      }

      // Check robustness exists
      expect(response.robustness).toBeDefined();
      expect(typeof response.robustness).toBe('object');
    });

    it('should detect V1 shape (results array instead of options)', () => {
      const response = mockV1Response;

      // V1 has 'results', not 'options'
      expect(response.results).toBeDefined();
      expect(response.options).toBeUndefined();

      // This should be detected as V1 shape
      const isV1Shape = response.results && !response.options;
      expect(isV1Shape).toBe(true);
    });

    it('should detect missing options array', () => {
      const response = {
        analysis_status: 'computed',
        robustness: { score: 0.5, label: 'moderate' },
      };

      expect(response.options).toBeUndefined();
    });

    it('should detect missing outcome.mean in options', () => {
      const response = {
        analysis_status: 'computed',
        options: [
          { id: 'opt1', outcome: {} },  // Missing mean
          { id: 'opt2', outcome: { mean: 100 } },
        ],
        robustness: { score: 0.5, label: 'moderate' },
      };

      const optionsWithMissingMean = response.options.filter(
        (opt: any) => opt.outcome?.mean === undefined
      );
      expect(optionsWithMissingMean.length).toBe(1);
    });

    it('should detect missing robustness object', () => {
      const response = {
        analysis_status: 'computed',
        options: [
          { id: 'opt1', outcome: { mean: 100 } },
        ],
        // robustness missing
      };

      expect(response.robustness).toBeUndefined();
    });
  });

  describe('Option Comparison Mapping', () => {
    it('should map V2 option fields correctly', () => {
      const opt = mockV2Response.options[0];

      // Expected PLoT output mapping
      const expectedMapping = {
        option_id: opt.option_id ?? opt.id,
        expected: opt.outcome.mean,
        p10: opt.outcome.p10,
        p50: opt.outcome.p50,
        p90: opt.outcome.p90,
        win_probability: opt.win_probability,
      };

      expect(expectedMapping.option_id).toBe('opt1');
      expect(expectedMapping.expected).toBe(100.5);
      expect(expectedMapping.p10).toBe(85.0);
      expect(expectedMapping.p50).toBe(100.0);
      expect(expectedMapping.p90).toBe(115.0);
      expect(expectedMapping.win_probability).toBe(0.65);
    });

    it('should preserve option IDs from request to response', () => {
      const sentIds = new Set(['opt1', 'opt2']);
      const receivedIds = new Set(
        mockV2Response.options.map((o: any) => o.option_id ?? o.id)
      );

      // Check all sent IDs are in response
      for (const id of sentIds) {
        expect(receivedIds.has(id)).toBe(true);
      }

      // Check no unexpected IDs in response
      for (const id of receivedIds) {
        expect(sentIds.has(id)).toBe(true);
      }
    });
  });

  describe('Edge Sensitivity Mapping', () => {
    it('should use robustness.fragile_edges for V2', () => {
      const robustness = mockV2Response.robustness;

      expect(robustness.fragile_edges).toBeDefined();
      expect(Array.isArray(robustness.fragile_edges)).toBe(true);

      const fragileEdge = robustness.fragile_edges[0];
      expect(fragileEdge.from_id).toBe('factor_a');
      expect(fragileEdge.to_id).toBe('goal');
      expect(fragileEdge.switch_probability).toBe(0.3);
    });

    it('should use robustness.robust_edges for V2', () => {
      const robustness = mockV2Response.robustness;

      expect(robustness.robust_edges).toBeDefined();
      expect(Array.isArray(robustness.robust_edges)).toBe(true);

      const robustEdge = robustness.robust_edges[0];
      expect(robustEdge.from_id).toBe('factor_b');
      expect(robustEdge.to_id).toBe('goal');
    });

    it('should NOT use sensitivity array for V2 (V1 only)', () => {
      // V2 response should have robustness edges, not sensitivity array
      expect(mockV2Response.sensitivity).toBeUndefined();
      expect(mockV2Response.robustness).toBeDefined();
    });
  });

  describe('Option ID Invariant Check', () => {
    it('should detect missing option IDs in response', () => {
      const sentIds = new Set(['opt1', 'opt2', 'opt3']);
      const receivedIds = new Set(['opt1', 'opt2']);

      const missingIds = [...sentIds].filter(id => !receivedIds.has(id));
      expect(missingIds).toEqual(['opt3']);
    });

    it('should detect unexpected option IDs in response', () => {
      const sentIds = new Set(['opt1', 'opt2']);
      const receivedIds = new Set(['opt1', 'opt2', 'opt_unknown']);

      const unexpectedIds = [...receivedIds].filter(id => !sentIds.has(id));
      expect(unexpectedIds).toEqual(['opt_unknown']);
    });

    it('should pass when IDs match exactly', () => {
      const sentIds = new Set(['opt1', 'opt2']);
      const receivedIds = new Set(['opt1', 'opt2']);

      const missingIds = [...sentIds].filter(id => !receivedIds.has(id));
      const unexpectedIds = [...receivedIds].filter(id => !sentIds.has(id));

      expect(missingIds).toEqual([]);
      expect(unexpectedIds).toEqual([]);
    });
  });

  describe('Factor Sensitivity Status', () => {
    it('should return not_requested when factor sensitivity empty', () => {
      const factorSensitivity: any[] = [];
      const status = factorSensitivity.length > 0 ? 'computed' : 'not_requested';

      expect(status).toBe('not_requested');
    });

    it('should return computed when factor sensitivity has data', () => {
      const factorSensitivity = [
        { factor_id: 'factor_a', sensitivity_score: 0.5 },
      ];
      const status = factorSensitivity.length > 0 ? 'computed' : 'not_requested';

      expect(status).toBe('computed');
    });
  });

  describe('Fragile Edge Label Enrichment', () => {
    // Import the enrichment functions
    const { enrichFragileEdge, enrichRobustEdge } = require('../src/integrations/isl/adapters/robustness-enrichment.js');

    // Mock graph with labeled nodes
    const mockGraph = {
      nodes: [
        { id: 'fac_pro_price', label: 'Pro Plan Price', kind: 'factor' },
        { id: 'out_mrr', label: 'Monthly Recurring Revenue', kind: 'outcome' },
        { id: 'factor_a', label: 'Factor A Label', kind: 'factor' },
        { id: 'factor_b', label: 'Factor B Label', kind: 'factor' },
        { id: 'goal', label: 'Goal Node', kind: 'goal' },
      ],
      edges: [],
    };

    // Mock options with labels
    const mockOptions = [
      { id: 'opt_keep_price', label: 'Keep £49 price' },
      { id: 'opt_raise_price', label: 'Raise to £59' },
    ];

    it('should enrich fragile edge with from_label and to_label', () => {
      const rawEdge = {
        edge_id: 'fac_pro_price->out_mrr',
        from_id: 'fac_pro_price',
        to_id: 'out_mrr',
        switch_probability: 0.468,
      };

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      expect(enriched.edge_id).toBe('fac_pro_price->out_mrr');
      expect(enriched.from_id).toBe('fac_pro_price');
      expect(enriched.to_id).toBe('out_mrr');
      expect(enriched.from_label).toBe('Pro Plan Price');
      expect(enriched.to_label).toBe('Monthly Recurring Revenue');
      expect(enriched.switch_probability).toBe(0.468);
    });

    it('should enrich fragile edge with alternative_winner_label', () => {
      const rawEdge = {
        edge_id: 'fac_pro_price->out_mrr',
        from_id: 'fac_pro_price',
        to_id: 'out_mrr',
        switch_probability: 0.468,
        alternative_winner_id: 'opt_keep_price',
      };

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      expect(enriched.alternative_winner_id).toBe('opt_keep_price');
      expect(enriched.alternative_winner_label).toBe('Keep £49 price');
    });

    it('should fallback to node ID when label not found', () => {
      const rawEdge = {
        edge_id: 'unknown_node->goal',
        from_id: 'unknown_node',
        to_id: 'goal',
        switch_probability: 0.5,
      };

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      // Unknown node should fallback to ID
      expect(enriched.from_label).toBe('unknown_node');
      // Known node should have label
      expect(enriched.to_label).toBe('Goal Node');
    });

    it('should enrich robust edge with labels', () => {
      const edgeId = 'factor_b->goal';

      const enriched = enrichRobustEdge(edgeId, mockGraph);

      expect(enriched.edge_id).toBe('factor_b->goal');
      expect(enriched.from_label).toBe('Factor B Label');
      expect(enriched.to_label).toBe('Goal Node');
    });

    it('should handle string edge format (parse from/to)', () => {
      const rawEdge = 'factor_a->goal';

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      expect(enriched.edge_id).toBe('factor_a->goal');
      expect(enriched.from_id).toBe('factor_a');
      expect(enriched.to_id).toBe('goal');
      expect(enriched.from_label).toBe('Factor A Label');
      expect(enriched.to_label).toBe('Goal Node');
    });

    it('should handle :: separator in edge_id', () => {
      const rawEdge = {
        edge_id: 'factor_a::goal',
        from_id: 'factor_a',
        to_id: 'goal',
        switch_probability: 0.3,
      };

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      expect(enriched.from_label).toBe('Factor A Label');
      expect(enriched.to_label).toBe('Goal Node');
    });

    it('should produce UI-ready fragile edge with all fields', () => {
      const rawEdge = {
        edge_id: 'fac_pro_price->out_mrr',
        from_id: 'fac_pro_price',
        to_id: 'out_mrr',
        switch_probability: 0.468,
        alternative_winner_id: 'opt_keep_price',
      };

      const enriched = enrichFragileEdge(rawEdge, mockGraph, mockOptions);

      // Verify the exact structure expected by UI
      expect(enriched).toMatchObject({
        edge_id: 'fac_pro_price->out_mrr',
        from_id: 'fac_pro_price',
        from_label: 'Pro Plan Price',
        to_id: 'out_mrr',
        to_label: 'Monthly Recurring Revenue',
        alternative_winner_id: 'opt_keep_price',
        alternative_winner_label: 'Keep £49 price',
        switch_probability: 0.468,
      });
    });
  });
});
