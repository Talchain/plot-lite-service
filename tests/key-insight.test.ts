/**
 * Key Insight Endpoint Tests
 *
 * Phase 2: Tests for /v1/assist/key-insight proxy endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerKeyInsightRoute, classifyGoalType, extractGoals } from '../src/routes/v1/key-insight.js';

describe('Key Insight Endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerKeyInsightRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/assist/key-insight', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for graph exceeding node limit', async () => {
      const nodes = Array.from({ length: 51 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: { nodes, edges: [] },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('max 50 nodes');
    });

    it('returns 400 for graph exceeding edge limit', async () => {
      const nodes = [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
      const edges = Array.from({ length: 201 }, () => ({
        from: 'a',
        to: 'b',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: { nodes, edges },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('max 100 edges');
    });

    it('returns successful response with valid graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Increase Revenue', kind: 'goal' },
              { id: 'dec1', label: 'Marketing Strategy', kind: 'decision' },
              { id: 'opt1', label: 'Social Media', kind: 'option' },
              { id: 'opt2', label: 'Email Marketing', kind: 'option' },
              { id: 'out1', label: 'Revenue Increase', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' },
              { from: 'dec1', to: 'opt1' },
              { from: 'dec1', to: 'opt2' },
              { from: 'opt1', to: 'out1', weight: 0.6 },
              { from: 'opt2', to: 'out1', weight: 0.4 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('key_insight.v1');
      expect(body.insight).toBeDefined();
      expect(body.insight.insight).toBeTruthy();
      expect(body.insight.confidence).toMatch(/high|medium|low/);
      expect(body.ranked_actions).toBeInstanceOf(Array);
      expect(body.ranking_confidence).toMatch(/high|medium|low/);
      expect(body.provenance).toBe('plot_fallback'); // CEE not enabled
      expect(body.model_card).toBeDefined();
      expect(body.model_card.seed).toBe(42);
    });

    it('generates ranked actions from option nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.3 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.ranked_actions.length).toBe(2);
      expect(body.ranked_actions[0].label).toBe('Option A');
      expect(body.ranked_actions[0].rank).toBe(1);
      expect(body.ranked_actions[1].label).toBe('Option B');
      expect(body.ranked_actions[1].rank).toBe(2);

      // Check distribution structure
      expect(body.ranked_actions[0].distribution).toHaveProperty('p10');
      expect(body.ranked_actions[0].distribution).toHaveProperty('p50');
      expect(body.ranked_actions[0].distribution).toHaveProperty('p90');
    });

    it('generates single ranked action for graph without options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
            ],
            edges: [{ from: 'a', to: 'b', weight: 0.5 }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.ranked_actions.length).toBe(1);
      expect(body.ranked_actions[0].label).toBe('Overall');
      expect(body.ranked_actions[0].rank).toBe(1);
    });

    it('includes context in response when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', kind: 'goal' },
              { id: 'b', label: 'B', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          context: {
            question: 'Should we invest in project X?',
            notes: 'Budget is limited',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Context is passed to CEE but response structure is validated
      expect(body.insight).toBeDefined();
    });

    it('uses provided outcome_node for inference', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
              { id: 'c', label: 'C', value: 75 },
            ],
            edges: [
              { from: 'a', to: 'b' },
              { from: 'b', to: 'c' },
            ],
          },
          outcome_node: 'b', // Explicitly specify non-last node
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('generates fallback insight with confidence message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Low Risk', kind: 'option' },
              { id: 'opt2', label: 'High Risk', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.9 },
              { from: 'opt2', to: 'out1', weight: 0.1 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Fallback insight mentions options
      expect(body.insight.insight).toContain('Low Risk');
      expect(body.insight.evidence).toBeInstanceOf(Array);
    });

    it('includes model_card with response_hash', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A', value: 100 }],
            edges: [],
          },
          seed: 123,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.seed).toBe(123);
      expect(body.model_card.nodes).toBe(1);
      expect(body.model_card.edges).toBe(0);
      expect(body.model_card.backend).toBe('scm_lite');
      expect(body.model_card.response_hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('deterministic response hash for same input', async () => {
      const payload = {
        graph: {
          nodes: [{ id: 'a', label: 'A', value: 100 }],
          edges: [],
        },
        seed: 999,
      };

      const response1 = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload,
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload,
      });

      const body1 = JSON.parse(response1.payload);
      const body2 = JSON.parse(response2.payload);

      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    });

    it('includes edge type inference warnings when types are inferred', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
              { id: 'opt1', label: 'Option', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' },  // functional inferred
              { from: 'dec1', to: 'opt1' },   // structural inferred
              { from: 'opt1', to: 'out1' },   // probabilistic inferred
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.warnings).toBeDefined();
      expect(body.warnings.length).toBeGreaterThanOrEqual(3);

      const edgeTypeWarnings = body.warnings.filter(
        (w: any) => w.code === 'EDGE_TYPE_INFERRED'
      );
      expect(edgeTypeWarnings.length).toBe(3);
      expect(edgeTypeWarnings[0].severity).toBe('info');
    });

    it('includes primary outcome inferred warning', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', kind: 'goal' },
              { id: 'b', label: 'B', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          // No outcome_node specified - will be inferred
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const outcomeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'PRIMARY_OUTCOME_INFERRED'
      );
      expect(outcomeWarnings?.length).toBe(1);
    });

    it('does not include edge type warnings when types are explicit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
            ],
            edges: [
              { from: 'goal1', to: 'dec1', edge_type: 'functional' },  // Explicit
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const edgeTypeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'EDGE_TYPE_INFERRED'
      ) ?? [];
      expect(edgeTypeWarnings.length).toBe(0);
    });

    it('does not include outcome warning when outcome_node is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          outcome_node: 'b',  // Explicitly provided
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const outcomeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'PRIMARY_OUTCOME_INFERRED'
      ) ?? [];
      expect(outcomeWarnings.length).toBe(0);
    });

    it('includes outcome_quality on ranked actions with positive outcomes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.3 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // All ranked actions should have outcome_quality
      for (const action of body.ranked_actions) {
        expect(action.outcome_quality).toBeDefined();
        expect(['positive', 'negative', 'neutral']).toContain(action.outcome_quality);
      }

      // With positive outcome value, expect positive outcome_quality
      expect(body.ranked_actions[0].outcome_quality).toBe('positive');
    });

    it('includes outcome_quality on single ranked action (no options)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
            ],
            edges: [{ from: 'a', to: 'b', weight: 0.5 }],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.ranked_actions.length).toBe(1);
      expect(body.ranked_actions[0].outcome_quality).toBeDefined();
      expect(['positive', 'negative', 'neutral']).toContain(body.ranked_actions[0].outcome_quality);
    });

    it('sets outcome_quality to negative for negative expected outcomes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Risky Option', kind: 'option' },
              { id: 'out1', label: 'Loss', kind: 'outcome', value: -50 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.8 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // With negative outcome value, expect negative outcome_quality
      expect(body.ranked_actions[0].outcome_quality).toBe('negative');
    });
  });
});

describe('Goal Type Classification', () => {
  describe('classifyGoalType', () => {
    // NOTE (ROADMAP 2.917): the currency symbols in this test and in
    // 'Target: $100k savings' below do NOT pin CONTINUOUS_PATTERNS' `[$£€]`
    // character class — these four assertions hold with the class deleted
    // outright. See 'currency symbols in CONTINUOUS_PATTERNS are load-bearing'
    // at the bottom of this describe for the assertions that do bind to it.
    it('classifies continuous goals with revenue targets', () => {
      expect(classifyGoalType('Reach £20k MRR in 12 months')).toBe('continuous');
      expect(classifyGoalType('Reach $20k MRR')).toBe('continuous');
      expect(classifyGoalType('Hit €50k ARR')).toBe('continuous');
      expect(classifyGoalType('20k MRR target')).toBe('continuous');
    });

    it('classifies continuous goals with percentage targets', () => {
      expect(classifyGoalType('Reduce churn to 4%')).toBe('continuous');
      expect(classifyGoalType('Achieve 90% retention')).toBe('continuous');
      expect(classifyGoalType('Keep under 5% churn')).toBe('continuous');
      expect(classifyGoalType('Stay below 10% error rate')).toBe('continuous');
    });

    it('classifies continuous goals with numeric targets', () => {
      expect(classifyGoalType('Increase to 100 users')).toBe('continuous');
      expect(classifyGoalType('Grow to $1M revenue')).toBe('continuous');
      expect(classifyGoalType('Target: $100k savings')).toBe('continuous');
      expect(classifyGoalType('At least 50 signups')).toBe('continuous');
    });

    it('classifies binary goals for launch/ship actions', () => {
      expect(classifyGoalType('Launch product successfully')).toBe('binary');
      expect(classifyGoalType('Ship feature by Q4')).toBe('binary');
      expect(classifyGoalType('Deliver MVP')).toBe('binary');
      expect(classifyGoalType('Complete migration')).toBe('binary');
    });

    it('classifies binary goals for approval/acquisition', () => {
      expect(classifyGoalType('Get board approval')).toBe('binary');
      expect(classifyGoalType('Secure funding round')).toBe('binary');
      expect(classifyGoalType('Win enterprise contract')).toBe('binary');
      expect(classifyGoalType('Close Series A')).toBe('binary');
    });

    it('classifies binary goals for questions', () => {
      expect(classifyGoalType('Should we expand to Europe?')).toBe('binary');
      expect(classifyGoalType('Is this worth pursuing?')).toBe('binary');
    });

    it('classifies compound goals with "and" connector', () => {
      expect(classifyGoalType('Reach 20k MRR and keep churn under 4%')).toBe('compound');
      expect(classifyGoalType('Launch product and achieve 90% satisfaction')).toBe('compound');
    });

    it('classifies compound goals with "while" connector', () => {
      expect(classifyGoalType('Grow revenue while reducing costs')).toBe('compound');
      expect(classifyGoalType('Scale users while maintaining quality')).toBe('compound');
    });

    it('classifies compound goals with "+" connector', () => {
      expect(classifyGoalType('Revenue growth + Cost reduction')).toBe('compound');
    });

    it('defaults to binary for goals without numbers', () => {
      expect(classifyGoalType('Improve customer satisfaction')).toBe('binary');
      expect(classifyGoalType('Enhance team productivity')).toBe('binary');
    });

    it('defaults to continuous for goals with numbers but no clear pattern', () => {
      expect(classifyGoalType('Achieve 5 new partnerships')).toBe('continuous');
      expect(classifyGoalType('Conduct 10 interviews')).toBe('continuous');
    });

    /**
     * ROADMAP 2.917 — bind the `[$£€]` character class in CONTINUOUS_PATTERNS.
     *
     * WHY THIS BLOCK EXISTS. The currency-bearing assertions elsewhere in this
     * file name the class but do not pin it. Measured at bc4b2a34 by replacing
     * `[$£€]` with an empty class in all three patterns that carry it
     * (`reach\s+[$£€]?\d`, `hit\s+[$£€]?\d`, `target[:\s]+[$£€]?\d`): the file
     * stayed 36/36 GREEN. Those labels survive for two different reasons —
     * 'Reach £20k MRR…', 'Reach $20k MRR' and 'Hit €50k ARR' are re-matched by
     * CONTINUOUS_PATTERNS' `\d+[%kKmM]\s*(mrr|arr|…)` entry, while
     * 'Target: $100k savings' is caught by the trailing `if (/\d/.test(text))`
     * fallback. Either way the currency class is not what decides them.
     *
     * WHERE THE CLASS IS ACTUALLY LOAD-BEARING. `classifyGoalType` checks
     * CONTINUOUS_PATTERNS *before* BINARY_PATTERNS. Because every currency-bearing
     * pattern also requires a digit, narrowing the class can never change a verdict
     * that the `/\d/` fallback would reach anyway — it can only change one where a
     * BINARY pattern is waiting in between. So the class changes an outcome exactly
     * when a label matches a currency-bearing continuous pattern *and* a binary
     * pattern, and no compound indicator or other continuous pattern. On such a
     * label, narrowing the class flips 'continuous' -> 'binary'.
     *
     * HOW EACH CASE PINS ITS OWN PRECONDITION. Every row carries a control that is
     * the same sentence with the pattern's verb swapped for a neutral one. The
     * control must classify 'binary' *while still containing a digit* — that is what
     * proves BINARY_PATTERNS short-circuits ahead of the `/\d/` fallback for this
     * shape, so the paired label's 'continuous' verdict is attributable to the
     * currency-bearing pattern and not to the fallback. Without the control the
     * assertion would be exactly the vacuous kind it replaces.
     *
     * SCOPE. These pin that the three symbols the class declares are honoured. They
     * deliberately do NOT assert that the class is limited to those three, so
     * widening it (adding a symbol) stays GREEN; that is a product decision, not a
     * property this block claims.
     */
    describe('currency symbols in CONTINUOUS_PATTERNS are load-bearing', () => {
      const currencyCases = [
        { pattern: 'reach', symbol: '£', label: 'Secure funding to reach £5m by Q4', control: 'Secure funding to obtain £5m by Q4' },
        { pattern: 'reach', symbol: '$', label: 'Secure funding to reach $5m by Q4', control: 'Secure funding to obtain $5m by Q4' },
        { pattern: 'reach', symbol: '€', label: 'Secure funding to reach €5m by Q4', control: 'Secure funding to obtain €5m by Q4' },
        { pattern: 'hit', symbol: '£', label: 'Secure funding to hit £5m by Q4', control: 'Secure funding to obtain £5m by Q4' },
        { pattern: 'hit', symbol: '$', label: 'Secure funding to hit $5m by Q4', control: 'Secure funding to obtain $5m by Q4' },
        { pattern: 'hit', symbol: '€', label: 'Secure funding to hit €5m by Q4', control: 'Secure funding to obtain €5m by Q4' },
        { pattern: 'target', symbol: '£', label: 'Secure funding to target £5m by Q4', control: 'Secure funding to obtain £5m by Q4' },
        { pattern: 'target', symbol: '$', label: 'Secure funding to target $5m by Q4', control: 'Secure funding to obtain $5m by Q4' },
        { pattern: 'target', symbol: '€', label: 'Secure funding to target €5m by Q4', control: 'Secure funding to obtain €5m by Q4' },
      ];

      it.each(currencyCases)(
        'the $pattern pattern honours $symbol, and the control shows the digit fallback is not deciding',
        ({ label, control }) => {
          // Precondition, pinned here rather than assumed: the control still contains
          // a digit, yet classifies 'binary'. So a 'continuous' verdict on `label`
          // cannot have come from the `/\d/` fallback.
          expect(classifyGoalType(control)).toBe('binary');

          // The only delta is the verb that lets the currency-bearing continuous
          // pattern match across the symbol. Narrow the class and this returns 'binary'.
          expect(classifyGoalType(label)).toBe('continuous');
        }
      );

      // A second, structurally different binary route to the same seam: the
      // trailing-'?' rule rather than a start-anchored verb. Included so the block
      // does not rest on one BINARY_PATTERNS entry.
      it('holds when the competing binary pattern is the trailing question mark', () => {
        expect(classifyGoalType('Can we obtain £5m by Q4?')).toBe('binary');
        expect(classifyGoalType('Can we hit £5m by Q4?')).toBe('continuous');
      });
    });
  });
});

describe('Goal Extraction', () => {
  describe('extractGoals', () => {
    it('extracts single goal from graph', () => {
      const nodes = [
        { id: 'goal1', label: 'Reach £20k MRR', kind: 'goal' },
        { id: 'dec1', label: 'Pricing Strategy', kind: 'decision' },
        { id: 'out1', label: 'Revenue', kind: 'outcome' },
      ];
      const edges = [
        { from: 'goal1', to: 'dec1' },
        { from: 'dec1', to: 'out1' },
      ];

      const { goals, primaryGoalId } = extractGoals(nodes, edges);

      expect(goals).toHaveLength(1);
      expect(goals[0].id).toBe('goal1');
      expect(goals[0].text).toBe('Reach £20k MRR');
      expect(goals[0].type).toBe('continuous');
      expect(goals[0].is_primary).toBe(true);
      expect(primaryGoalId).toBe('goal1');
    });

    it('extracts multiple goals with primary selection based on decision connection weight', () => {
      const nodes = [
        { id: 'goal1', label: 'Launch product', kind: 'goal' },
        { id: 'goal2', label: 'Reach £20k MRR', kind: 'goal' },
        { id: 'dec1', label: 'Strategy', kind: 'decision' },
        { id: 'out1', label: 'Revenue', kind: 'outcome' },
      ];
      const edges = [
        { from: 'goal1', to: 'dec1', weight: 0.3 },
        { from: 'goal2', to: 'dec1', weight: 0.7 },
        { from: 'dec1', to: 'out1' },
      ];

      const { goals, primaryGoalId } = extractGoals(nodes, edges);

      expect(goals).toHaveLength(2);
      expect(primaryGoalId).toBe('goal2'); // Higher weight
      expect(goals[0].id).toBe('goal2'); // Primary first
      expect(goals[0].is_primary).toBe(true);
      expect(goals[1].id).toBe('goal1');
      expect(goals[1].is_primary).toBe(false);
    });

    it('returns empty goals when no goal nodes exist', () => {
      const nodes = [
        { id: 'dec1', label: 'Decision', kind: 'decision' },
        { id: 'out1', label: 'Outcome', kind: 'outcome' },
      ];
      const edges = [{ from: 'dec1', to: 'out1' }];

      const { goals, primaryGoalId } = extractGoals(nodes, edges);

      expect(goals).toHaveLength(0);
      expect(primaryGoalId).toBeNull();
    });

    it('uses node order when weights are equal', () => {
      const nodes = [
        { id: 'goal1', label: 'First goal', kind: 'goal' },
        { id: 'goal2', label: 'Second goal', kind: 'goal' },
        { id: 'dec1', label: 'Decision', kind: 'decision' },
      ];
      const edges = [
        { from: 'goal1', to: 'dec1', weight: 0.5 },
        { from: 'goal2', to: 'dec1', weight: 0.5 },
      ];

      const { goals, primaryGoalId } = extractGoals(nodes, edges);

      expect(primaryGoalId).toBe('goal1'); // First in order
      expect(goals[0].is_primary).toBe(true);
    });

    it('handles goals with no edge to decision nodes', () => {
      const nodes = [
        { id: 'goal1', label: 'Orphan goal', kind: 'goal' },
        { id: 'out1', label: 'Outcome', kind: 'outcome' },
      ];
      const edges = [{ from: 'goal1', to: 'out1' }];

      const { goals, primaryGoalId } = extractGoals(nodes, edges);

      expect(goals).toHaveLength(1);
      expect(primaryGoalId).toBe('goal1');
    });

    it('uses node ID as fallback when label is missing', () => {
      const nodes = [
        { id: 'goal_revenue_target', kind: 'goal' },
      ];
      const edges: Array<{ from: string; to: string }> = [];

      const { goals } = extractGoals(nodes, edges);

      expect(goals[0].text).toBe('goal_revenue_target');
    });

    it('classifies goal types correctly in extraction', () => {
      const nodes = [
        { id: 'g1', label: 'Launch MVP', kind: 'goal' },
        { id: 'g2', label: 'Reach $50k MRR', kind: 'goal' },
        { id: 'g3', label: 'Grow revenue and reduce churn', kind: 'goal' },
      ];
      const edges: Array<{ from: string; to: string }> = [];

      const { goals } = extractGoals(nodes, edges);

      const goalMap = new Map(goals.map(g => [g.id, g]));
      expect(goalMap.get('g1')?.type).toBe('binary');
      expect(goalMap.get('g2')?.type).toBe('continuous');
      expect(goalMap.get('g3')?.type).toBe('compound');
    });
  });
});
