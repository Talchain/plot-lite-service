/**
 * LANE 3 Car 4 (P1/P4) — ISL critiques merge on BOTH paths (ROADMAP 2.410,
 * folding 2.394(a)): success-path critiques + the affected_node_ids field fix.
 *
 * Two defects, both verified at the bytes (PLoT `d011b996`, ISL staging):
 *
 *  D1 — ISL's v2 SUCCESS body carries `critiques` ("always a list, never
 *       None" — src/api/robustness.py response builder), including the
 *       MARGINAL_SWITCH_TRUNCATED coverage disclosure ISL's own comment says
 *       exists so "we publish what we computed and name what we did not"
 *       (critique.py:357). PLoT's success path builds its critiques from
 *       pre-detection + preflight + normalisation only (run.ts:6906) and
 *       never reads `islResult.critiques` — the disclosure is dropped on
 *       every 200.
 *  D2 — ISL serialises `affected_node_ids` / `affected_option_ids`
 *       (CritiqueV2, models/critique.py build()); PLoT's `ISLCritique`
 *       declares `affected_nodes` and `mapISLCritiquesToV2` reads ONLY
 *       `c.affected_nodes` (run.ts:4018) — so on the live 422 path, node
 *       identity silently drops for every v2-format critique.
 *
 * RED-FIRST at pristine: D1/D2 tests fail; the two named controls pass.
 * Assertions bind by IDENTITY (code + exact ids), never bare counts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Switchable ISL mock — same pattern as v2-typed-failure-envelope.test.ts.
// ---------------------------------------------------------------------------
type IslBehaviour =
  | { kind: 'computed' }
  | { kind: 'computed-with-critiques'; critiques: unknown[] }
  | {
      kind: 'error';
      error: {
        code: string;
        message: string;
        retryable: boolean;
        status?: number;
        critiques?: unknown[];
      };
    };

let islBehaviour: IslBehaviour = { kind: 'computed' };

const mockISLService = {
  isEnabled: () => true,
  async callAnalysisEndpoint<T>(): Promise<unknown> {
    if (islBehaviour.kind === 'error') {
      return { data: null, error: islBehaviour.error, latency_ms: 5, isl_echoed_request_id: null };
    }
    const data = makeComputedIslResponse() as Record<string, unknown>;
    if (islBehaviour.kind === 'computed-with-critiques') {
      data.critiques = islBehaviour.critiques;
    }
    return { data: data as T, latency_ms: 5, isl_echoed_request_id: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';
import { makeValidRunBody, makeComputedIslResponse } from './helpers/run-fixtures.js';

/** ISL v2-format critique rows EXACTLY as CritiqueV2 serialises them
 * (id/code/severity/source/message/affected_option_ids/affected_node_ids/
 * suggestion — models/critique.py build(), fetched at ISL staging tip). */
const MARGINAL_SWITCH_ROW = {
  id: 'isl-det-0001',
  code: 'MARGINAL_SWITCH_TRUNCATED',
  severity: 'warning',
  source: 'analysis',
  message:
    'Marginal switch probability was computed for the 3 most elastic fragile edge(s) of 7; ' +
    'the remaining 4 carry marginal_switch_probability=null. Each edge\'s sweep costs 40 ' +
    'isolated re-evaluations per option, so the set is bounded to keep the analysis inside ' +
    'its compute-admission budget. Retained values are unaffected — each is computed ' +
    'independently of the others',
  affected_node_ids: ['edge_a', 'edge_b'],
  suggestion:
    'The omitted edges are the least elastic of the fragile set; if a specific edge\'s ' +
    'marginal contribution matters, re-run with a graph scoped to it',
};

const GOAL_GAP_ROW = {
  id: 'isl-det-0002',
  code: 'GOAL_ANCESTOR_DATA_GAP',
  severity: 'warning',
  source: 'analysis',
  message: 'Goal ancestor n_low has no observed data',
  affected_node_ids: ['n_low'],
};

describe('/v2/run — ISL critiques merge on both paths (2.410)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── D1: success path (RED at pristine) ────────────────────────────────
  it('RED D1 — a 200 response carries ISL success-body critiques, identity-bound', async () => {
    islBehaviour = { kind: 'computed-with-critiques', critiques: [MARGINAL_SWITCH_ROW, GOAL_GAP_ROW] };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('computed');

    const marginal = (body.critiques ?? []).filter((c: any) => c.code === 'MARGINAL_SWITCH_TRUNCATED');
    expect(marginal).toHaveLength(1);
    expect(marginal[0].severity).toBe('warning');
    expect(marginal[0].source).toBe('isl');
    expect(marginal[0].blocks_analysis).toBe(false);
    // D2's field fix must apply here too: ISL v2 rows carry affected_node_ids.
    expect(marginal[0].affected_node_ids).toEqual(['edge_a', 'edge_b']);
    expect(marginal[0].user_message).toBeTruthy();

    const gap = (body.critiques ?? []).filter((c: any) => c.code === 'GOAL_ANCESTOR_DATA_GAP');
    expect(gap).toHaveLength(1);
    expect(gap[0].affected_node_ids).toEqual(['n_low']);
  });

  it('RED D1b — product copy: MARGINAL_SWITCH_TRUNCATED user_message is real copy, not the unknown-code fallback, and leaks no internals', async () => {
    islBehaviour = { kind: 'computed-with-critiques', critiques: [MARGINAL_SWITCH_ROW] };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    const row = res.json().critiques.find((c: any) => c.code === 'MARGINAL_SWITCH_TRUNCATED');
    expect(row).toBeDefined();
    // 2.410: "add product copy for MARGINAL_SWITCH_TRUNCATED" — the generic
    // fallback sentence is not product copy.
    expect(row.user_message).not.toContain('An issue was detected in your model');
    // No internal jargon on the user surface.
    expect(row.user_message).not.toContain('marginal_switch_probability');
    expect(row.user_message).not.toContain('null');
  });

  // ── D2: 422 path field fix (RED at pristine) ──────────────────────────
  it('RED D2 — a 422 blocked response carries affected_node_ids from ISL v2-format critiques', async () => {
    islBehaviour = {
      kind: 'error',
      error: {
        code: 'ISL_HTTP_422',
        message: 'ISL validation failed',
        retryable: false,
        status: 422,
        critiques: [
          {
            id: 'isl-det-0003',
            code: 'GRAPH_DISCONNECTED',
            severity: 'blocker',
            source: 'validation',
            message: 'Nodes n_orphan unreachable from goal',
            affected_node_ids: ['n_orphan'],
            suggestion: 'Connect or remove the disconnected nodes',
          },
        ],
      },
    };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(res.statusCode).toBe(422);
    const row = res.json().critiques.find((c: any) => c.code === 'GRAPH_DISCONNECTED');
    expect(row).toBeDefined();
    expect(row.affected_node_ids).toEqual(['n_orphan']);
    expect(row.blocks_analysis).toBe(true);
  });

  // ── Controls (named; GREEN at pristine) ───────────────────────────────
  it('CONTROL (green at pristine) — legacy affected_nodes 422 shape still carries node identity after the fix', async () => {
    islBehaviour = {
      kind: 'error',
      error: {
        code: 'ISL_HTTP_422',
        message: 'ISL validation failed',
        retryable: false,
        status: 422,
        critiques: [
          {
            code: 'INVALID_NODE_ID',
            severity: 'blocker',
            message: 'Node ref broken',
            affected_nodes: ['n_legacy'],
          },
        ],
      },
    };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(res.statusCode).toBe(422);
    const row = res.json().critiques.find((c: any) => c.code === 'INVALID_NODE_ID');
    expect(row).toBeDefined();
    expect(row.affected_node_ids).toEqual(['n_legacy']);
  });

  it('CONTROL (green at pristine) — a computed run whose ISL body has NO critiques fabricates none (no isl-source rows)', async () => {
    islBehaviour = { kind: 'computed' };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('computed');
    const islRows = (body.critiques ?? []).filter((c: any) => c.source === 'isl');
    expect(islRows).toEqual([]);
  });
});
