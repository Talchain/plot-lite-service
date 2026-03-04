/**
 * A.8: Staging contract integration tests
 *
 * These tests POST to a live staging instance and assert the response contract.
 * They codify what smoke tests check manually and gate production deployment.
 *
 * Gating:
 *   RUN_INTEGRATION_TESTS=1  — required to run (skipped by default in CI)
 *   PLOT_STAGING_URL          — staging base URL (default: https://plot-lite-service-staging.onrender.com)
 *   INTEGRATION_TIMEOUT_MS    — per-request timeout (default: 30000)
 *
 * These tests are idempotent and read-only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENABLED = process.env.RUN_INTEGRATION_TESTS === '1';
const STAGING_URL = (process.env.PLOT_STAGING_URL ?? 'https://plot-lite-service-staging.onrender.com').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS) || 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`,
    );
  }
}

async function postV2Run(
  request: object,
  requestId?: string,
): Promise<{ status: number; data: any }> {
  const id = requestId ?? randomUUID();
  const res = await fetch(`${STAGING_URL}/v2/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': id,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await parseJsonSafe(res);
  return { status: res.status, data };
}

async function postValidatePatch(
  request: object,
  requestId?: string,
): Promise<{ status: number; data: any }> {
  const id = requestId ?? randomUUID();
  const res = await fetch(`${STAGING_URL}/v1/validate-patch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': id,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await parseJsonSafe(res);
  return { status: res.status, data };
}

function assertResponseShape(data: any, expectedFields: string[]): void {
  for (const field of expectedFields) {
    expect(data, `missing field: ${field}`).toHaveProperty(field);
  }
}

// ---------------------------------------------------------------------------
// Fixture graph: 1 goal, 3 factors, 2 options, 3 edges
// ---------------------------------------------------------------------------

const FIXTURE_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-price', kind: 'factor', label: 'Price', observed_state: { value: 50 } },
    { id: 'factor-demand', kind: 'factor', label: 'Demand', observed_state: { value: 100 } },
    { id: 'factor-quality', kind: 'factor', label: 'Quality', observed_state: { value: 70 } },
  ],
  edges: [
    { from: 'factor-price', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
    { from: 'factor-demand', to: 'goal', exists_probability: 0.85, strength: { mean: 0.5, std: 0.15 } },
    { from: 'factor-quality', to: 'factor-demand', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
  ],
};

const FIXTURE_OPTIONS = [
  {
    id: 'opt-premium',
    label: 'Premium Strategy',
    interventions: { 'factor-price': { value: 80, source: 'user_specified' as const } },
  },
  {
    id: 'opt-volume',
    label: 'Volume Strategy',
    interventions: { 'factor-demand': { value: 150, source: 'user_specified' as const } },
  },
];

const FIXTURE_REQUEST = {
  graph: FIXTURE_GRAPH,
  options: FIXTURE_OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

// ---------------------------------------------------------------------------
// Connectivity check — skip all tests if staging is unreachable
// ---------------------------------------------------------------------------

let stagingReachable = false;

describe.skipIf(!ENABLED)('A.8: Staging contract integration tests', () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${STAGING_URL}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      stagingReachable = res.ok;
    } catch {
      stagingReachable = false;
    }

    if (!stagingReachable) {
      console.warn(`[A.8] Staging unreachable at ${STAGING_URL} — skipping integration tests`);
    }
  });

  // -----------------------------------------------------------------------
  // Response shape tests
  // -----------------------------------------------------------------------

  describe.skipIf(!stagingReachable)('Response shape', () => {
    it('normal quantitative analysis returns complete response shape', async () => {
      const { status, data } = await postV2Run(FIXTURE_REQUEST);

      expect(status).toBe(200);
      expect(data.analysis_status).toBe('computed');

      // Option comparison
      expect(Array.isArray(data.option_comparison)).toBe(true);
      expect(data.option_comparison.length).toBe(FIXTURE_OPTIONS.length);
      for (const opt of data.option_comparison) {
        expect(opt).toHaveProperty('option_id');
        expect(opt.outcome).toBeDefined();
        expect(typeof opt.outcome.p10).toBe('number');
        expect(typeof opt.outcome.p50).toBe('number');
        expect(typeof opt.outcome.p90).toBe('number');
      }

      // Factor sensitivity
      expect(Array.isArray(data.factor_sensitivity)).toBe(true);
      expect(data.factor_sensitivity.length).toBeGreaterThan(0);
      for (const f of data.factor_sensitivity) {
        expect(typeof f.elasticity).toBe('number');
        expect(typeof f.confidence).toBe('number');
        expect(f.confidence).toBeGreaterThanOrEqual(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
      }

      // Factor stability (B8-8 contract: present when ISL provides 3C fields)
      if (data.factor_stability !== undefined) {
        expect(Array.isArray(data.factor_stability)).toBe(true);
        for (const entry of data.factor_stability) {
          expect(typeof entry.factor_id).toBe('string');
          expect(typeof entry.elasticity_std).toBe('number');
          expect(['high', 'moderate', 'low', 'negligible']).toContain(entry.attribution_stability);
          expect(typeof entry.rank_flip_rate).toBe('number');
          expect(typeof entry.stability_method).toBe('string');
        }
      }

      // Response hash
      expect(typeof data.response_hash).toBe('string');
      expect(data.response_hash).toMatch(/^[0-9a-f]{16}$/);

      // Meta
      assertResponseShape(data.meta, ['seed_used', 'n_samples', 'latency_ms']);
      expect(typeof data.meta.seed_used).toBe('string');
      expect(data.meta.request_id_chain).toBeDefined();
      expect(data.meta.request_id_chain).toHaveProperty('plot_request_id');
    }, TIMEOUT_MS + 5_000);

    it('review_cards shape is valid when present', async () => {
      const { status, data } = await postV2Run(FIXTURE_REQUEST);

      expect(status).toBe(200);

      // review_cards may be present depending on staging config
      if (data.review_cards !== undefined) {
        expect(Array.isArray(data.review_cards)).toBe(true);

        for (const card of data.review_cards) {
          expect(card).toHaveProperty('card_type');
          expect(card).toHaveProperty('priority_band');
          expect(Array.isArray(card.supporting_refs)).toBe(true);
        }
      }
    }, TIMEOUT_MS + 5_000);

    it('review card supporting_refs have valid structure', async () => {
      const { status, data } = await postV2Run(FIXTURE_REQUEST);

      expect(status).toBe(200);

      if (data.review_cards && data.review_cards.length > 0) {
        for (const card of data.review_cards) {
          for (const ref of card.supporting_refs) {
            // Discriminated union: fact | violation | critique
            expect(['fact', 'violation', 'critique']).toContain(ref.kind);
            expect(typeof ref.id).toBe('string');
            expect(ref.id.length).toBeGreaterThan(0);

            // Role is required for fact refs, optional for violation/critique
            if (ref.kind === 'fact') {
              expect(['supports', 'explains', 'derived_from']).toContain(ref.role);
            }
          }
        }
      }
    }, TIMEOUT_MS + 5_000);

    it('response includes decision_brief when present', async () => {
      const { status, data } = await postV2Run(FIXTURE_REQUEST);

      expect(status).toBe(200);

      // decision_brief is either present (object) or absent/null
      if (data.decision_brief != null) {
        expect(typeof data.decision_brief).toBe('object');
        expect(data.decision_brief).toHaveProperty('headline');
        expect(Array.isArray(data.decision_brief.options)).toBe(true);
      }
    }, TIMEOUT_MS + 5_000);

    it('deterministic — same input produces same response_hash', async () => {
      const [res1, res2] = await Promise.all([
        postV2Run(FIXTURE_REQUEST),
        postV2Run(FIXTURE_REQUEST),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    }, TIMEOUT_MS * 2 + 5_000);
  });

  // -----------------------------------------------------------------------
  // Validate-patch tests
  // -----------------------------------------------------------------------

  describe.skipIf(!stagingReachable)('Validate-patch', () => {
    const PATCH_GRAPH = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    it('accepts valid add_node operation', async () => {
      const { status, data } = await postValidatePatch({
        graph: PATCH_GRAPH,
        operations: [
          {
            op: 'add_node',
            path: 'factor-new',
            value: { id: 'factor-new', kind: 'factor', label: 'New Factor', observed_state: { value: 30 } },
          },
        ],
      });

      expect(status).toBe(200);
      expect(data.status).toBe('applied');
      expect(typeof data.graph_hash).toBe('string');
      expect(data.graph_hash.length).toBeGreaterThan(0);
      expect(Array.isArray(data.repairs_applied)).toBe(true);
    }, TIMEOUT_MS + 5_000);

    it('rejects operation referencing non-existent node', async () => {
      const { status, data } = await postValidatePatch({
        graph: PATCH_GRAPH,
        operations: [
          {
            op: 'remove_node',
            path: 'does-not-exist',
          },
        ],
      });

      // Should reject with meaningful error
      expect(status).toBe(422);
      expect(data.status).toBe('rejected');
      expect(typeof data.code).toBe('string');
      expect(typeof data.message).toBe('string');
    }, TIMEOUT_MS + 5_000);

    it('rejects cyclic graph with CYCLE_DETECTED code', async () => {
      // Add an edge that creates a cycle: factor-a → goal → factor-a
      const { status, data } = await postValidatePatch({
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
          ],
          edges: [
            { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        operations: [
          {
            op: 'add_edge',
            path: 'goal->factor-a',
            value: { from: 'goal', to: 'factor-a', exists_probability: 0.7, strength: { mean: 0.4, std: 0.1 } },
          },
        ],
      });

      expect(status).toBe(422);
      expect(data.status).toBe('rejected');
      expect(data.code).toBe('CYCLE_DETECTED');
    }, TIMEOUT_MS + 5_000);

    it('validate-patch success shape includes all required fields', async () => {
      const { status, data } = await postValidatePatch({
        graph: PATCH_GRAPH,
        operations: [
          {
            op: 'add_node',
            path: 'factor-new',
            value: { id: 'factor-new', kind: 'factor', label: 'New Factor', observed_state: { value: 30 } },
          },
        ],
      });

      expect(status).toBe(200);
      // V.1 success shape: status, graph, graph_hash, repairs_applied, warnings
      expect(data.status).toBe('applied');
      expect(data.graph).toBeDefined();
      expect(typeof data.graph_hash).toBe('string');
      expect(data.graph_hash.length).toBeGreaterThan(0);
      expect(Array.isArray(data.repairs_applied)).toBe(true);
      expect(Array.isArray(data.warnings)).toBe(true);
    }, TIMEOUT_MS + 5_000);
  });

  // -----------------------------------------------------------------------
  // Edge-case resilience tests
  // -----------------------------------------------------------------------

  describe.skipIf(!stagingReachable)('Edge-case resilience', () => {
    it('handles missing optional fields gracefully', async () => {
      // Minimal valid graph — no constraints, no categories, minimal edges
      const { status, data } = await postV2Run({
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Goal' },
            { id: 'f1', kind: 'factor', label: 'Factor', observed_state: { value: 50 } },
          ],
          edges: [
            { from: 'f1', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'A', interventions: { f1: { value: 80, source: 'user_specified' } } },
          { id: 'opt2', label: 'B', interventions: { f1: { value: 20, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      });

      expect(status).toBe(200);
      expect(['computed', 'partial']).toContain(data.analysis_status);
    }, TIMEOUT_MS + 5_000);

    it('handles no constraints gracefully', async () => {
      // Graph without any constraints — constraint_analysis should be null/absent
      const { status, data } = await postV2Run(FIXTURE_REQUEST);

      expect(status).toBe(200);

      // constraint_analysis should be null or absent when no constraints provided
      if ('constraint_analysis' in data) {
        expect(data.constraint_analysis).toBeNull();
      }
      // Response should be otherwise complete
      expect(data.analysis_status).toBeDefined();
      expect(data.meta).toBeDefined();
    }, TIMEOUT_MS + 5_000);
  });
});
