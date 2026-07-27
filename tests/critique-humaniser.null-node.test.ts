/**
 * Null graph-node hardening for the critique humaniser (masked-200 class).
 *
 * ============================================================================
 * WHAT IS BROKEN (pre-existing on staging a5ffa60b — NOT a regression from
 * #285; found by #285's adversarial review)
 * ============================================================================
 * The /v2/run Ajv body schema types `graph.nodes` as `{ type: 'array' }` — the
 * container only, the ITEMS entirely unvalidated (src/routes/v2/run.ts:1276).
 * So `graph: { nodes: [null], edges: [] }` is a well-formed request as far as
 * validation is concerned.
 *
 * The humaniser then dereferences each element unguarded:
 *
 *   src/critique-humaniser.ts:46   graph.nodes.find((n) => n.id === nodeId)
 *   src/critique-humaniser.ts:62   graph.nodes.find((n) => n.id === optionId)
 *   src/critique-humaniser.ts:107  g.nodes.find((n) => n.id === nodeId)
 *
 * `n.id` on a null element throws a TypeError. All sixteen 422
 * `buildBlockedResponse` sites on /v2/run run their critiques through
 * `addUserMessages(critiques, body.graph, body.options)`
 * (src/routes/v2/run.ts:1557), so the throw escapes the blocked path into the
 * handler's outermost catch (:7457), which answers `analysis_status: "failed"`
 * + `PLOT_INTERNAL_ERROR` + `retryable: true` (:7471).
 *
 * MEASURED SHAPE ON PRISTINE a5ffa60b — note the correction. The review that
 * found this described it as "HTTP 200 + PLOT_INTERNAL_ERROR". The BODY half is
 * exactly right; the STATUS half is not, for this corner. The call site is
 * `reply.status(422).send(buildBlockedResponse(...))`, so 422 is already stamped
 * on the reply when the argument expression throws, and the catch's bare
 * `reply.send(...)` inherits it. The pristine response is:
 *
 *   HTTP 422
 *   { analysis_status: "failed", status_reason: "Internal server error",
 *     retryable: true, critiques: [ PLOT_INTERNAL_ERROR ] }
 *
 * — a 422 whose body claims a retryable internal failure, with the precise
 * INVALID_INTERVENTION_VALUE blocker (and its affected_option_ids /
 * affected_node_ids) destroyed. So `expect(statusCode).toBe(422)` below is a
 * PIN, not the discriminator: the discriminating assertions are
 * `analysis_status` and the critique codes.
 *
 * THE REVIEWER'S CORNER (route DEFECT test below). Line 62 only runs when the
 * option lookup misses, so all three must hold at once:
 *   1. `graph.nodes: [null]`        — the unvalidated item
 *   2. a malformed intervention     — fires the ingress guard's 422, which is
 *                                     what invokes the humaniser at all
 *   3. option `label: ""`           — `option?.label` is FALSY on an empty
 *                                     string, so resolveOptionLabel falls
 *                                     through to the graph lookup at :62
 * With a non-empty label the option lookup short-circuits and the defect is
 * invisible — which is why it survived to now.
 *
 * ============================================================================
 * TEST LABELS — assigned by what the mutation run proved, not by intent
 * ============================================================================
 *   DEFECT: went RED on pristine a5ffa60b (and again when the `n?.id` hunks
 *           were reverted in a throwaway worktree).
 *   PIN:    green both ways — pins that the fix did not change label
 *           resolution for well-formed graphs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  humaniseCritique,
  resolveNodeLabel,
  TEMPLATE_MAP,
} from '../src/critique-humaniser.js';
import type { GraphForLabels } from '../src/critique-humaniser.js';
import type { CritiqueV3 } from '../src/types/engine-v3.js';

const { createServer } = await import('../src/createServer.js');

/** A graph that survives Ajv (`nodes` is an array) but poisons every reader. */
const NULL_NODE_GRAPH = { nodes: [null], edges: [] } as unknown as GraphForLabels;

// ---------------------------------------------------------------------------
// Route level — the masked 200
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  app = await createServer();
});
afterAll(async () => {
  await app?.close();
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.CEE_ORCHESTRATOR_ENABLED;
});

describe('POST /v2/run · null graph node must not mask the blocker', () => {
  it('DEFECT: the reviewer corner returns the precise blocker, not a masked PLOT_INTERNAL_ERROR', async () => {
    // Pristine a5ffa60b: HTTP 422 (pre-stamped) + analysis_status "failed" +
    // PLOT_INTERNAL_ERROR + retryable:true. See the header for why the status
    // code is not the discriminator here.
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: {
        graph: { nodes: [null], edges: [] },
        options: [
          // label: "" is load-bearing — see header.
          { id: 'o1', label: '', interventions: { f: null, g: 60 } },
          { id: 'o2', label: 'O2', interventions: { f: 80, g: 40 } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const critiques = (body.critiques ?? []) as Array<Record<string, unknown>>;
    const codes = critiques.map((c) => c.code);

    expect(res.statusCode).toBe(422);
    expect(body.analysis_status).toBe('blocked');
    expect(codes).toContain('INVALID_INTERVENTION_VALUE');
    expect(codes).not.toContain('PLOT_INTERNAL_ERROR');

    // Precise blocker attribution survives — the caller can act on this.
    const blocker = critiques.find((c) => c.code === 'INVALID_INTERVENTION_VALUE')!;
    expect(blocker.affected_option_ids).toEqual(['o1']);
    expect(blocker.affected_node_ids).toEqual(['f']);
    expect(typeof blocker.user_message).toBe('string');
    expect(blocker.user_message as string).not.toHaveLength(0);
  });

  it('PIN: the same malformed intervention on a well-formed graph is unchanged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: {
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'G' },
            { id: 'f', kind: 'factor', label: 'F' },
            { id: 'g', kind: 'factor', label: 'GG' },
          ],
          edges: [],
        },
        options: [
          { id: 'o1', label: 'O1', interventions: { f: null, g: 60 } },
          { id: 'o2', label: 'O2', interventions: { f: 80, g: 40 } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const critiques = (body.critiques ?? []) as Array<Record<string, unknown>>;
    expect(res.statusCode).toBe(422);
    expect(critiques.map((c) => c.code)).toContain('INVALID_INTERVENTION_VALUE');
    const blocker = critiques.find((c) => c.code === 'INVALID_INTERVENTION_VALUE')!;
    expect(blocker.user_message as string).toContain('O1');
  });
});

// ---------------------------------------------------------------------------
// Unit level — one test per unguarded dereference
// ---------------------------------------------------------------------------

describe('critique-humaniser · null-tolerant node lookup', () => {
  it('DEFECT (:46 resolveNodeLabel): falls back to the humanised id instead of throwing', () => {
    expect(() => resolveNodeLabel('fac_customer_churn', NULL_NODE_GRAPH)).not.toThrow();
    expect(resolveNodeLabel('fac_customer_churn', NULL_NODE_GRAPH)).toBe('Customer Churn');
  });

  it('DEFECT (:62 resolveOptionLabel graph fallback): empty option label + null node does not throw', () => {
    const critique: CritiqueV3 = {
      id: 'c1',
      code: 'INVALID_INTERVENTION_VALUE',
      severity: 'blocker',
      message: "Option 'o1' has an invalid intervention value for node 'f'.",
      source: 'validation',
      affected_option_ids: ['o1'],
      affected_node_ids: ['f'],
      blocks_analysis: true,
    } as CritiqueV3;
    // label: '' is falsy, so the resolver falls through to the graph lookup.
    const options = [{ id: 'o1', label: '' }];
    expect(() => humaniseCritique(critique, NULL_NODE_GRAPH, options)).not.toThrow();
    expect(humaniseCritique(critique, NULL_NODE_GRAPH, options)).toContain('O1');
  });

  it('DEFECT (:107 GOAL_NODE_NOT_CAUSAL): resolver tolerates a null node', () => {
    const critique: CritiqueV3 = {
      id: 'c2',
      code: 'GOAL_NODE_NOT_CAUSAL',
      severity: 'blocker',
      message: 'Goal node is not causal.',
      source: 'validation',
      affected_node_ids: ['goal_x'],
      blocks_analysis: true,
    } as CritiqueV3;
    const resolver = TEMPLATE_MAP.GOAL_NODE_NOT_CAUSAL;
    expect(typeof resolver).toBe('function');
    expect(() => humaniseCritique(critique, NULL_NODE_GRAPH)).not.toThrow();
    expect(humaniseCritique(critique, NULL_NODE_GRAPH)).toContain('non-causal');
  });

  it('PIN: a well-formed graph still resolves the real label', () => {
    const graph: GraphForLabels = {
      nodes: [{ id: 'fac_customer_churn', label: 'Customer Churn', kind: 'factor' }],
    };
    expect(resolveNodeLabel('fac_customer_churn', graph)).toBe('Customer Churn');
  });
});
