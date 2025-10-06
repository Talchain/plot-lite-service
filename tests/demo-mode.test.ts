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

describe('Demo Mode - Deterministic Responses', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4351';
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

  describe('Query parameter: ?demo=1', () => {
    it('returns deterministic sample for /v1/run', async () => {
      const res = await fetch(`${BASE}/v1/run?demo=1&seed=42`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: [], edges: [] } }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.graph).toBeDefined();
      expect(data.graph.nodes).toBeInstanceOf(Array);
      expect(data.model_card).toBeDefined();
      expect(data.confidence).toBeDefined();
    });

    it('returns same response for same seed', async () => {
      const seed = 123;
      
      const res1 = await fetch(`${BASE}/v1/run?demo=1&seed=${seed}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: [], edges: [] } }),
      });
      const data1 = await res1.json();
      
      const res2 = await fetch(`${BASE}/v1/run?demo=1&seed=${seed}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: [], edges: [] } }),
      });
      const data2 = await res2.json();
      
      // Deep comparison of model_card
      expect(data1.model_card.seed).toBe(data2.model_card.seed);
      expect(data1.model_card.determinism_note).toBe(data2.model_card.determinism_note);
    });

    it('returns deterministic sample for /v1/counterfactual', async () => {
      const res = await fetch(`${BASE}/v1/counterfactual?demo=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: [], edges: [] }, intervention: {}, outcome_node: 'x' }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.schema).toBe('counterfactual.v1');
    });

    it('returns deterministic sample for /v1/critique', async () => {
      const res = await fetch(`${BASE}/v1/critique?demo=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: [], edges: [] } }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.schema).toBe('critique.v1');
    });
  });

  describe('Header: X-Demo: 1', () => {
    it('returns demo response via header', async () => {
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Demo': '1',
        },
        body: JSON.stringify({ graph: { nodes: [], edges: [] } }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.graph.nodes).toBeInstanceOf(Array);
      expect(data.graph.nodes.length).toBeGreaterThan(0);
    });

    it('header takes precedence over body', async () => {
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Demo': '1',
        },
        body: JSON.stringify({ 
          graph: { 
            nodes: [{ id: 'wrong', label: 'Should be ignored' }], 
            edges: [] 
          } 
        }),
      });
      expect(res.status).toBe(200);
      
      const data = await res.json();
      // Demo payload should override body
      expect(data.graph.nodes.length).toBeGreaterThan(1);
    });
  });
});
