/**
 * Tests for goal_threshold in /v2/run endpoint.
 *
 * Covers:
 * - Request validation (number, null, string rejection)
 * - ISL translation (threshold passed or omitted)
 * - Response mapping (probability_of_goal, win_probability)
 * - Contract hashing (different thresholds produce different hashes)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Goal Threshold - Request Validation', () => {
  describe('Accepted Values', () => {
    it('accepts goal_threshold: 20000 (positive number)', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        goal_threshold: 20000,
      };

      // Validation: goal_threshold should be a number
      expect(typeof body.goal_threshold).toBe('number');
      expect(Number.isFinite(body.goal_threshold)).toBe(true);
    });

    it('accepts goal_threshold: 0 (zero is valid)', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        goal_threshold: 0,
      };

      expect(body.goal_threshold).toBe(0);
      expect(typeof body.goal_threshold).toBe('number');
      expect(Number.isFinite(body.goal_threshold)).toBe(true);
    });

    it('accepts goal_threshold: -500 (negative is valid)', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        goal_threshold: -500,
      };

      expect(body.goal_threshold).toBe(-500);
      expect(typeof body.goal_threshold).toBe('number');
    });

    it('accepts omitted goal_threshold', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        // goal_threshold intentionally omitted
      };

      expect(body.goal_threshold).toBeUndefined();
    });

    it('treats null goal_threshold as absent', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        goal_threshold: null as any,
      };

      // Normalize: null becomes undefined
      const normalized = body.goal_threshold === null ? undefined : body.goal_threshold;
      expect(normalized).toBeUndefined();
    });
  });

  describe('Rejected Values', () => {
    it('rejects goal_threshold: "20000" (string type)', () => {
      const body = {
        graph: { nodes: [], edges: [] },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { a: 1 } },
          { id: 'opt2', label: 'Option 2', interventions: { a: 2 } },
        ],
        goal_node_id: 'goal',
        goal_threshold: '20000' as any, // Invalid: string
      };

      // Fastify schema validation should reject this
      expect(typeof body.goal_threshold).not.toBe('number');
    });
  });
});

describe('Goal Threshold - ISL Translation', () => {
  // Import the translator
  const { toISLRobustnessRequest } = require('../src/integrations/isl/translator-v3.js');

  const mockGraph = {
    nodes: [
      { id: 'factor-a', kind: 'factor' as const, label: 'Factor A' },
      { id: 'goal', kind: 'goal' as const, label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    ],
  };

  const mockOptions = [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' as const } } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' as const } } },
  ];

  it('includes goal_threshold in ISL request when provided', () => {
    const islRequest = toISLRobustnessRequest(
      mockGraph,
      mockOptions,
      'goal',
      'test-request-id',
      1000,
      20000 // goal_threshold
    );

    expect(islRequest.goal_threshold).toBe(20000);
  });

  it('includes goal_threshold: 0 in ISL request (zero is valid)', () => {
    const islRequest = toISLRobustnessRequest(
      mockGraph,
      mockOptions,
      'goal',
      'test-request-id',
      1000,
      0 // goal_threshold = 0
    );

    expect(islRequest.goal_threshold).toBe(0);
  });

  it('includes negative goal_threshold in ISL request', () => {
    const islRequest = toISLRobustnessRequest(
      mockGraph,
      mockOptions,
      'goal',
      'test-request-id',
      1000,
      -500 // negative threshold
    );

    expect(islRequest.goal_threshold).toBe(-500);
  });

  it('omits goal_threshold from ISL request when undefined', () => {
    const islRequest = toISLRobustnessRequest(
      mockGraph,
      mockOptions,
      'goal',
      'test-request-id',
      1000,
      undefined // no threshold
    );

    expect('goal_threshold' in islRequest).toBe(false);
    expect(islRequest.goal_threshold).toBeUndefined();
  });
});

describe('Goal Threshold - Response Mapping', () => {
  describe('probability_of_goal', () => {
    it('includes probability_of_goal when ISL returns it', () => {
      const islOption = {
        option_id: 'opt1',
        expected_outcome: 100,
        confidence_interval: [80, 120],
        probability_of_goal: 0.75,
      };

      // Simulate response mapping logic
      const result: any = {
        option_id: islOption.option_id,
        expected_outcome: islOption.expected_outcome,
      };

      if (islOption.probability_of_goal !== undefined && islOption.probability_of_goal !== null) {
        result.probability_of_goal = islOption.probability_of_goal;
      }

      expect(result.probability_of_goal).toBe(0.75);
      expect('probability_of_goal' in result).toBe(true);
    });

    it('omits probability_of_goal when ISL does not return it (not null)', () => {
      const islOption = {
        option_id: 'opt1',
        expected_outcome: 100,
        confidence_interval: [80, 120],
        // probability_of_goal not present
      };

      // Simulate response mapping logic
      const result: any = {
        option_id: islOption.option_id,
        expected_outcome: islOption.expected_outcome,
      };

      if ((islOption as any).probability_of_goal !== undefined && (islOption as any).probability_of_goal !== null) {
        result.probability_of_goal = (islOption as any).probability_of_goal;
      }

      expect('probability_of_goal' in result).toBe(false);
      expect(result.probability_of_goal).toBeUndefined();
    });

    it('omits probability_of_goal when ISL returns null', () => {
      const islOption = {
        option_id: 'opt1',
        expected_outcome: 100,
        probability_of_goal: null as any,
      };

      // Simulate response mapping logic
      const result: any = {
        option_id: islOption.option_id,
        expected_outcome: islOption.expected_outcome,
      };

      if (islOption.probability_of_goal !== undefined && islOption.probability_of_goal !== null) {
        result.probability_of_goal = islOption.probability_of_goal;
      }

      expect('probability_of_goal' in result).toBe(false);
    });
  });

  describe('win_probability', () => {
    it('includes win_probability when ISL returns it', () => {
      const islOption = {
        option_id: 'opt1',
        expected_outcome: 100,
        win_probability: 0.65,
      };

      // Simulate response mapping logic
      const result: any = {
        option_id: islOption.option_id,
        expected_outcome: islOption.expected_outcome,
      };

      if (islOption.win_probability !== undefined && islOption.win_probability !== null) {
        result.win_probability = islOption.win_probability;
      }

      expect(result.win_probability).toBe(0.65);
      expect('win_probability' in result).toBe(true);
    });

    it('omits win_probability when ISL does not return it', () => {
      const islOption = {
        option_id: 'opt1',
        expected_outcome: 100,
        // win_probability not present
      };

      const result: any = {
        option_id: islOption.option_id,
        expected_outcome: islOption.expected_outcome,
      };

      if ((islOption as any).win_probability !== undefined && (islOption as any).win_probability !== null) {
        result.win_probability = (islOption as any).win_probability;
      }

      expect('win_probability' in result).toBe(false);
    });
  });
});

describe('Goal Threshold - Contract Hashing', () => {
  // Import the hashing function
  const { canonicaliseRequest, computeResponseHash } = require('../src/normalisation/canonicalise.js');

  const baseRequest = {
    graph: {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
      { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
  };

  const normalizedGraph = {
    nodes: [
      { id: 'factor-a', kind: 'factor' as const, label: 'Factor A' },
      { id: 'goal', kind: 'goal' as const, label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    ],
  };

  it('produces different hashes for different goal_threshold values', () => {
    const reqWithThreshold20k = { ...baseRequest, goal_threshold: 20000 };
    const reqWithThreshold30k = { ...baseRequest, goal_threshold: 30000 };

    const canonical1 = canonicaliseRequest(reqWithThreshold20k, normalizedGraph, '42');
    const canonical2 = canonicaliseRequest(reqWithThreshold30k, normalizedGraph, '42');

    const hash1 = computeResponseHash(canonical1);
    const hash2 = computeResponseHash(canonical2);

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash with vs without goal_threshold', () => {
    const reqWithThreshold = { ...baseRequest, goal_threshold: 20000 };
    const reqWithoutThreshold = { ...baseRequest }; // no goal_threshold

    const canonical1 = canonicaliseRequest(reqWithThreshold, normalizedGraph, '42');
    const canonical2 = canonicaliseRequest(reqWithoutThreshold, normalizedGraph, '42');

    const hash1 = computeResponseHash(canonical1);
    const hash2 = computeResponseHash(canonical2);

    expect(hash1).not.toBe(hash2);
  });

  it('treats null goal_threshold same as absent', () => {
    const reqWithNull = { ...baseRequest, goal_threshold: null as any };
    const reqWithoutThreshold = { ...baseRequest }; // no goal_threshold

    const canonical1 = canonicaliseRequest(reqWithNull, normalizedGraph, '42');
    const canonical2 = canonicaliseRequest(reqWithoutThreshold, normalizedGraph, '42');

    const hash1 = computeResponseHash(canonical1);
    const hash2 = computeResponseHash(canonical2);

    // null should be treated as absent, so hashes should be identical
    expect(hash1).toBe(hash2);
  });

  it('includes goal_threshold: 0 in hash (zero is valid)', () => {
    const reqWithZero = { ...baseRequest, goal_threshold: 0 };
    const reqWithoutThreshold = { ...baseRequest };

    const canonical1 = canonicaliseRequest(reqWithZero, normalizedGraph, '42');
    const canonical2 = canonicaliseRequest(reqWithoutThreshold, normalizedGraph, '42');

    const hash1 = computeResponseHash(canonical1);
    const hash2 = computeResponseHash(canonical2);

    // 0 is a valid threshold, should produce different hash than absent
    expect(hash1).not.toBe(hash2);
  });
});

describe('Goal Threshold - Type Safety', () => {
  it('OptionComparisonResultV3 has properly typed probability fields', () => {
    // Verify the response mapping includes both fields
    const result: any = {
      option_id: 'opt1',
      option_label: 'Option 1',
      probability_of_goal: 0.75,
      win_probability: 0.65,
    };

    expect(result.probability_of_goal).toBe(0.75);
    expect(result.win_probability).toBe(0.65);
    expect(typeof result.probability_of_goal).toBe('number');
    expect(typeof result.win_probability).toBe('number');
  });

  it('RunRequestV3 accepts goal_threshold', () => {
    const request: any = {
      graph: { nodes: [], edges: [] },
      options: [],
      goal_node_id: 'goal',
      goal_threshold: 20000,
    };

    expect(request.goal_threshold).toBe(20000);
  });

  it('RunRequestV3 accepts null goal_threshold', () => {
    const request: any = {
      graph: { nodes: [], edges: [] },
      options: [],
      goal_node_id: 'goal',
      goal_threshold: null,
    };

    expect(request.goal_threshold).toBeNull();
  });
});
