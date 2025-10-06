import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('v1 Routes - PLoT Engine v1', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4350';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['dist/main.js'], {
      env: {
        ...process.env,
        PORT,
        TEST_ROUTES: '0',
        RATE_LIMIT_ENABLED: '0',
      },
      stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 8000);
  });

  afterAll(async () => {
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });

  describe('GET /v1/health', () => {
    it('returns 200 with api_version', async () => {
      const res = await fetch(`${BASE}/v1/health`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.api_version).toBe('v1');
      expect(typeof data.p95_ms).toBe('number');
    });
  });

  describe('GET /v1/version', () => {
    it('returns version and features', async () => {
      const res = await fetch(`${BASE}/v1/version`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.api).toBe('plot-engine/v1');
      expect(data.version).toBe('1.0.0');
      expect(data.features).toBeDefined();
      expect(data.features.trust_signals).toBe(true);
      expect(data.features.model_card).toBe('1.1');
      expect(data.features.confidence_badge).toBe(true);
      expect(data.features.explain_delta).toBe(true);
    });
  });

  describe('POST /v1/run', () => {
    it('requires graph in request body', async () => {
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      
      const data = await res.json();
      expect(data.error).toContain('graph');
    });

    it('returns full trust signals with valid graph', async () => {
      const graph = {
        nodes: [
          { id: 'n1', label: 'Price' },
          { id: 'n2', label: 'Demand' },
          { id: 'n3', label: 'Revenue' },
        ],
        edges: [
          { from: 'n1', to: 'n2', weight: 0.8 },
          { from: 'n2', to: 'n3', weight: 0.9 },
        ],
      };

      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, seed: 123 }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      
      // Schema check
      expect(data.schema).toBe('run.v1');
      
      // Trust signals present
      expect(data.model_card).toBeDefined();
      expect(data.model_card.seed).toBe(123);
      expect(data.model_card.assumptions_summary).toBeInstanceOf(Array);
      expect(data.model_card.determinism_note).toContain('Deterministic');
      
      expect(data.confidence).toBeDefined();
      expect(data.confidence.level).toMatch(/^(LOW|MEDIUM|HIGH)$/);
      expect(data.confidence.reason).toBeDefined();
      expect(data.confidence.score).toBeGreaterThanOrEqual(0);
      expect(data.confidence.score).toBeLessThanOrEqual(1);
      
      expect(data.explain_delta).toBeDefined();
      expect(data.explain_delta.top_drivers).toBeInstanceOf(Array);
      expect(data.explain_delta.summary).toBeDefined();
      
      expect(data.critique).toBeInstanceOf(Array);
      expect(data.identifiability).toBeDefined();
    });
  });

  describe('POST /v1/counterfactual', () => {
    it('requires intervention', async () => {
      const graph = {
        nodes: [{ id: 'n1', label: 'A' }],
        edges: [],
      };

      const res = await fetch(`${BASE}/v1/counterfactual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph }),
      });
      expect(res.status).toBe(400);
    });

    it('returns counterfactual with trust signals', async () => {
      const graph = {
        nodes: [
          { id: 'treatment', label: 'Treatment' },
          { id: 'outcome', label: 'Outcome' },
        ],
        edges: [
          { from: 'treatment', to: 'outcome', weight: 0.7 },
        ],
      };

      const res = await fetch(`${BASE}/v1/counterfactual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph,
          intervention: {
            node_id: 'treatment',
            from_value: 100,
            to_value: 150,
          },
          outcome_node: 'outcome',
          seed: 456,
        }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.schema).toBe('counterfactual.v1');
      expect(data.model_card).toBeDefined();
      expect(data.model_card.seed).toBe(456);
      expect(data.confidence).toBeDefined();
      expect(data.explain_delta).toBeDefined();
      expect(data.results).toBeDefined();
      expect(data.results.baseline).toBeDefined();
      expect(data.results.counterfactual).toBeDefined();
      expect(data.results.delta).toBeDefined();
    });
  });

  describe('POST /v1/critique', () => {
    it('returns critique with severity levels', async () => {
      const graph = {
        nodes: [
          { id: 'n1', label: 'A' },
          { id: 'n2', label: 'B' },
        ],
        edges: [],
      };

      const res = await fetch(`${BASE}/v1/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.schema).toBe('critique.v1');
      expect(data.critique).toBeInstanceOf(Array);
      expect(data.model_card).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.summary.total_issues).toBeGreaterThanOrEqual(0);
      
      // Check critique items have correct structure
      if (data.critique.length > 0) {
        const item = data.critique[0];
        expect(item.severity).toMatch(/^(BLOCKER|IMPROVEMENT|OBSERVATION)$/);
        expect(item.message).toBeDefined();
      }
    });
  });

  describe('POST /v1/draft', () => {
    it('requires description', async () => {
      const res = await fetch(`${BASE}/v1/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('generates starter boards from text', async () => {
      const res = await fetch(`${BASE}/v1/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Optimise subscription pricing',
          domain: 'pricing',
        }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.schema).toBe('draft.v1');
      expect(data.boards).toBeInstanceOf(Array);
      expect(data.boards.length).toBeGreaterThan(0);
      expect(data.boards.length).toBeLessThanOrEqual(3);
      
      const board = data.boards[0];
      expect(board.name).toBeDefined();
      expect(board.graph).toBeDefined();
      expect(board.graph.nodes).toBeInstanceOf(Array);
      expect(board.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(board.critique).toBeInstanceOf(Array);
      expect(board.simplified).toBeDefined();
    });

    it('rejects description over 500 chars', async () => {
      const longDesc = 'a'.repeat(501);
      const res = await fetch(`${BASE}/v1/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: longDesc }),
      });
      expect(res.status).toBe(400);
    });
  });
});
