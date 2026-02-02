/**
 * Decision Review — Live CEE Integration Test
 *
 * This test makes real HTTP calls to CEE and validates the full M2 pipeline.
 * Skip unless configured with CEE_LIVE_TEST=true.
 *
 * Required environment variables:
 * - CEE_LIVE_TEST=true — enables the test
 * - CEE_BASE_URL — CEE staging URL
 * - CEE_API_KEY — CEE API key
 * - DECISION_REVIEW_ENABLE=true — enables M2 pipeline
 *
 * @see Brief: M2 Decision Review Integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { orchestrateDecisionReview, type DecisionReviewInput } from '../../src/cee/decision-review-orchestrator.js';
import { validateM1Review, buildValidationContext } from '../../src/cee/validation/m1-review-validator.js';
import { buildDecisionReviewRequest, type ISLResultInput } from '../../src/cee/decision-review-request.js';
import type { EngineGraphV3, OptionV3 } from '../../src/types/engine-v3.js';
import type { M1Coaching } from '../../src/coaching/types.js';

// =============================================================================
// Configuration
// =============================================================================

const LIVE = process.env.CEE_LIVE_TEST === 'true';
const CEE_BASE_URL = process.env.CEE_BASE_URL?.trim() ?? '';
const CEE_API_KEY = process.env.CEE_API_KEY?.trim() ?? '';

// Test brief: UK vs US market launch decision
const TEST_BRIEF = `We are deciding whether to launch our B2B SaaS product in the UK market first or the US market first. UK has lower competition but smaller TAM. US has larger TAM but requires more capital and has established competitors. We have £500k runway and a 6-person team.`;

// Timeout: 30s to accommodate cold starts on Render free tier
const TEST_TIMEOUT_MS = 30_000;

// =============================================================================
// Helper: Call CEE draft-graph endpoint
// =============================================================================

interface DraftGraphResponse {
  graph: {
    nodes: Array<{ id: string; kind?: string; label: string; [key: string]: unknown }>;
    edges: Array<{ from: string; to: string; [key: string]: unknown }>;
  };
  options?: Array<{ id: string; label: string }>;
  outcome_node?: string;
  [key: string]: unknown;
}

async function callDraftGraph(brief: string): Promise<DraftGraphResponse> {
  const url = `${CEE_BASE_URL.replace(/\/$/, '')}/assist/v1/draft-graph?schema=v3`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Olumi-Assist-Key': CEE_API_KEY,
      'X-Request-Id': randomUUID(),
    },
    body: JSON.stringify({ brief }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`CEE draft-graph failed: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

// =============================================================================
// Helper: Build mock ISL results from graph
// =============================================================================

function buildMockISLResult(graph: EngineGraphV3, options: OptionV3[]): ISLResultInput {
  // Generate realistic ISL results based on the options
  const winProbabilities = options.length === 2
    ? [0.62, 0.38] // Typical 2-option split
    : options.map((_, i) => 1 / options.length);

  return {
    options: options.map((opt, i) => ({
      option_id: opt.id,
      option_label: opt.label,
      win_probability: winProbabilities[i],
      expected_outcome: 0.5 + (winProbabilities[i] - 0.5) * 0.3,
    })),
    factor_sensitivity: graph.nodes
      .filter(n => n.kind === 'factor')
      .slice(0, 5)
      .map((node, i) => ({
        factor_id: node.id,
        factor_label: node.label,
        elasticity: 0.3 - i * 0.05,
        confidence: 0.7 + i * 0.05,
        direction: i % 2 === 0 ? 'positive' : 'negative',
      })),
    robustness: {
      recommendation_stability: 0.75,
      flip_risk_category: 'moderate',
      is_robust: true,
      fragile_edges: graph.edges.slice(0, 2).map((edge, i) => ({
        edge_id: `edge-${i}`,
        from_id: edge.from,
        to_id: edge.to,
        switch_probability: 0.15 - i * 0.05,
        marginal_switch_probability: 0.08 - i * 0.02,
      })),
    },
  };
}

// =============================================================================
// Helper: Build mock M1 coaching from ISL results
// =============================================================================

function buildMockM1Coaching(islResult: ISLResultInput, options: OptionV3[]): M1Coaching {
  const winnerIdx = (islResult.options ?? []).reduce(
    (maxIdx, opt, i, arr) => (opt.win_probability ?? 0) > (arr[maxIdx]?.win_probability ?? 0) ? i : maxIdx,
    0
  );

  return {
    readiness: 'ready',
    headline_type: 'clear_winner',
    story_headlines: Object.fromEntries(
      options.map((opt, i) => [
        opt.id,
        i === winnerIdx
          ? `${opt.label} emerges as the recommended choice`
          : `${opt.label} presents an alternative path`,
      ])
    ),
    evidence_gaps: (islResult.factor_sensitivity ?? []).slice(0, 3).map(f => ({
      factor_id: f.factor_id,
      factor_label: f.factor_label ?? f.factor_id,
      confidence: f.confidence ?? 0.7,
      confidence_display: `${Math.round((f.confidence ?? 0.7) * 100)}%`,
      confidence_defaulted: false,
      voi_score: Math.abs(f.elasticity ?? 0.2) * 0.5,
      influence: Math.abs(f.elasticity ?? 0.2),
      influence_display: `${Math.round(Math.abs(f.elasticity ?? 0.2) * 100)}%`,
      suggestion: `Consider gathering more data on ${f.factor_label ?? f.factor_id}`,
      notes: [],
    })),
    model_critiques: [],
    next_actions: [
      { action: 'Validate key assumptions', priority: 'high' },
      { action: 'Review risk factors', priority: 'medium' },
    ],
    coaching_version: '1.1.0',
    computed_at: new Date().toISOString(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe.skipIf(!LIVE)('Decision Review — Live CEE Integration', () => {
  let draftGraphResult: DraftGraphResponse;
  let graph: EngineGraphV3;
  let options: OptionV3[];

  beforeAll(async () => {
    // Validate environment
    if (!CEE_BASE_URL) {
      throw new Error('CEE_BASE_URL not configured');
    }
    if (!CEE_API_KEY) {
      throw new Error('CEE_API_KEY not configured');
    }

    // Enable decision review flag for tests
    process.env.DECISION_REVIEW_ENABLE = 'true';

    // Step 1: Call CEE draft-graph to get a real graph
    console.log('[Live Test] Calling CEE draft-graph...');
    draftGraphResult = await callDraftGraph(TEST_BRIEF);

    // Normalize graph to EngineGraphV3
    graph = {
      nodes: draftGraphResult.graph.nodes.map(n => ({
        id: n.id,
        kind: (n.kind ?? 'factor') as any,
        label: n.label,
        ...n,
      })),
      edges: draftGraphResult.graph.edges.map(e => ({
        from: e.from,
        to: e.to,
        strength: { mean: 0.5, std: 0.1 },
        ...e,
      })),
    };

    // Extract options from draft-graph result or graph
    options = draftGraphResult.options?.map(o => ({
      id: o.id,
      label: o.label,
      interventions: {},
    })) ?? graph.nodes
      .filter(n => n.kind === 'option')
      .map(n => ({
        id: n.id,
        label: n.label,
        interventions: {},
      }));

    console.log(`[Live Test] Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${options.length} options`);
  }, TEST_TIMEOUT_MS);

  it('completes M2 decision review with valid response', async () => {
    // Build ISL results (mock, since we're testing M2 not ISL)
    const islResult = buildMockISLResult(graph, options);

    // Build M1 coaching
    const m1Coaching = buildMockM1Coaching(islResult, options);

    // Build orchestrator input
    const input: DecisionReviewInput = {
      brief: TEST_BRIEF,
      graph,
      options,
      islResult,
      m1Coaching,
      responseHash: `live-test-${Date.now()}`,
      requestId: randomUUID(),
    };

    // Call orchestrator
    console.log('[Live Test] Calling orchestrateDecisionReview...');
    const startMs = Date.now();

    const result = await orchestrateDecisionReview(input, {
      baseUrl: CEE_BASE_URL,
      apiKey: CEE_API_KEY,
      timeoutMs: TEST_TIMEOUT_MS,
    });

    const latencyMs = Date.now() - startMs;
    console.log(`[Live Test] Completed in ${latencyMs}ms, status: ${result.review_status}`);

    // Log diagnostics on any failure
    if (result.review_status !== 'complete') {
      console.error('[Live Test] FAILURE DIAGNOSTICS:');
      console.error('  review_status:', result.review_status);
      console.error('  review_failure_codes:', result.review_failure_codes ?? []);
      console.error('  review_meta:', JSON.stringify(result.review_meta, null, 2));
    }

    // Assertions
    expect(result.review_status).toBe('complete');
    expect(result.m1_review).not.toBeNull();

    // Verify m1_review passes validation
    if (result.m1_review) {
      const request = buildDecisionReviewRequest(
        TEST_BRIEF,
        graph,
        options,
        islResult,
        m1Coaching
      );
      const validationContext = buildValidationContext(request);
      const validationResult = validateM1Review(result.m1_review, validationContext);

      if (!validationResult.valid) {
        console.error('[Live Test] VALIDATION FAILURE:');
        console.error('  errors:', JSON.stringify(validationResult.errors, null, 2));
        console.error('  failure_codes:', validationResult.failure_codes);
      }

      expect(validationResult.valid).toBe(true);
      expect(validationResult.errors).toHaveLength(0);
    }

    // Verify review_meta contains expected fields
    expect(result.review_meta).toBeDefined();
    expect(result.review_meta?.model).toBeDefined();
    expect(result.review_meta?.latency_ms).toBeGreaterThan(0);
    expect(result.review_meta?.tokens).toBeGreaterThan(0);

    console.log('[Live Test] SUCCESS');
    console.log('  model:', result.review_meta?.model);
    console.log('  latency_ms:', result.review_meta?.latency_ms);
    console.log('  tokens:', result.review_meta?.tokens);
  }, TEST_TIMEOUT_MS);

  it('handles decision brief with clear market comparison', async () => {
    // This test uses the same graph but validates specific M1Review content
    const islResult = buildMockISLResult(graph, options);
    const m1Coaching = buildMockM1Coaching(islResult, options);

    const input: DecisionReviewInput = {
      brief: TEST_BRIEF,
      graph,
      options,
      islResult,
      m1Coaching,
      responseHash: `live-test-content-${Date.now()}`,
      requestId: randomUUID(),
    };

    const result = await orchestrateDecisionReview(input, {
      baseUrl: CEE_BASE_URL,
      apiKey: CEE_API_KEY,
      timeoutMs: TEST_TIMEOUT_MS,
    });

    // Log diagnostics on failure
    if (result.review_status !== 'complete') {
      console.error('[Live Test Content] FAILURE DIAGNOSTICS:');
      console.error('  review_status:', result.review_status);
      console.error('  review_failure_codes:', result.review_failure_codes ?? []);
      console.error('  review_meta:', JSON.stringify(result.review_meta, null, 2));
    }

    expect(result.review_status).toBe('complete');
    expect(result.m1_review).not.toBeNull();

    // Verify M1Review has expected structure
    if (result.m1_review) {
      expect(result.m1_review.narrative_summary).toBeTruthy();
      expect(result.m1_review.story_headlines).toBeDefined();
      expect(Object.keys(result.m1_review.story_headlines).length).toBeGreaterThan(0);
      expect(result.m1_review.robustness_explanation).toBeDefined();
      expect(result.m1_review.readiness_rationale).toBeTruthy();
    }
  }, TEST_TIMEOUT_MS);
});
