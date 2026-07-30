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

describe('Determinism - Same seed → Identical output', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4352';
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

  const testGraph = {
    nodes: [
      { id: 'price', label: 'Price' },
      { id: 'demand', label: 'Demand' },
      { id: 'revenue', label: 'Revenue' },
    ],
    edges: [
      { from: 'price', to: 'demand', weight: 0.7 },
      { from: 'demand', to: 'revenue', weight: 0.9 },
    ],
  };

  describe('/v1/run determinism', () => {
    it('same seed produces identical model_card', async () => {
      const seed = 4242;
      
      const [res1, res2] = await Promise.all([
        fetch(`${BASE}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed }),
        }),
        fetch(`${BASE}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed }),
        }),
      ]);
      
      const data1 = await res1.json();
      const data2 = await res2.json();
      
      expect(data1.model_card.seed).toBe(data2.model_card.seed);
      expect(data1.model_card.determinism_note).toBe(data2.model_card.determinism_note);
      expect(JSON.stringify(data1.model_card.assumptions_summary)).toBe(
        JSON.stringify(data2.model_card.assumptions_summary)
      );
    });

    it('same seed produces identical confidence score', async () => {
      const seed = 5555;
      
      const res1 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed }),
      });
      const data1 = await res1.json();
      
      const res2 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed }),
      });
      const data2 = await res2.json();
      
      expect(data1.confidence.level).toBe(data2.confidence.level);
      expect(data1.confidence.score).toBe(data2.confidence.score);
    });

    it('different seeds may produce different explain_delta', async () => {
      const res1 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: 111 }),
      });
      const data1 = await res1.json();
      
      const res2 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: 222 }),
      });
      const data2 = await res2.json();
      
      // With different seeds, explain_delta may differ (due to random sensitivities)
      // But structure should be identical
      expect(data1.explain_delta.top_drivers).toBeInstanceOf(Array);
      expect(data2.explain_delta.top_drivers).toBeInstanceOf(Array);
    });
  });

  // ROADMAP 2.105 — BLOCK REMOVED, and the reason is worth recording.
  //
  // This block asserted that /v1/counterfactual was deterministic across two
  // identical requests. It passed, and it was meaningless: the route's output was
  // `from_value * 100` / `to_value * 95` with the graph never read, so it was a
  // CONSTANT FUNCTION OF THE INPUT. Determinism was guaranteed by the fabrication
  // rather than by a seeded model — and the route's model card advertised exactly
  // that guarantee ("Same seed guarantees identical output"), which is how a
  // vacuous property came to read as evidence of a well-behaved simulation.
  //
  // A determinism test can only be meaningful where something non-deterministic
  // could otherwise happen. The route is now WITHDRAWN (typed 501); its refusal
  // contract is pinned in tests/analysis-routes.refusal.test.ts.

  describe('Determinism note in model_card', () => {
    it('includes seed in determinism_note', async () => {
      const seed = 9999;
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed }),
      });
      const data = await res.json();
      
      expect(data.model_card.determinism_note).toContain('Deterministic');
      expect(data.model_card.determinism_note).toContain(String(seed));
    });

    it('notes non-deterministic when seed is 0', async () => {
      const res = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: 0 }),
      });
      const data = await res.json();
      
      expect(data.model_card.determinism_note).toContain('Non-deterministic');
    });
  });

  describe('P0: Strict determinism - 20× identical runs', () => {
    it('same graph + same seed → 20 identical explain_delta outputs', async () => {
      const seed = 999;
      const payload = {
        graph: testGraph,
        seed,
        k_samples: 1000,
      };

      // Run 20 times
      const responses: any[] = [];
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${BASE}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        responses.push(data);
      }

      // Verify all responses have explain_delta
      expect(responses.length).toBe(20);
      for (const resp of responses) {
        expect(resp.explain_delta).toBeDefined();
        expect(resp.explain_delta.top_drivers).toBeInstanceOf(Array);
      }

      // Verify all explain_delta are identical
      const first = JSON.stringify(responses[0].explain_delta);
      for (let i = 1; i < 20; i++) {
        const current = JSON.stringify(responses[i].explain_delta);
        expect(current).toBe(first);
      }

      // Also verify model_card seed is consistent
      for (const resp of responses) {
        expect(resp.model_card.seed).toBe(seed);
      }
    }, 30000);

    it('different seeds → different but still deterministic explain_delta', async () => {
      const seed1 = 111;
      const seed2 = 222;

      const res1 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: seed1 }),
      });
      const data1 = await res1.json();

      const res2 = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: seed2 }),
      });
      const data2 = await res2.json();

      // Different seeds should produce different model_card.seed values
      expect(data1.model_card.seed).toBe(seed1);
      expect(data2.model_card.seed).toBe(seed2);
      expect(data1.model_card.seed).not.toBe(data2.model_card.seed);

      // But each seed should be deterministic (run again with seed1)
      const res1again = await fetch(`${BASE}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: seed1 }),
      });
      const data1again = await res1again.json();
      // Same seed produces identical results
      expect(data1again.model_card.seed).toBe(seed1);
      expect(JSON.stringify(data1again.explain_delta)).toBe(JSON.stringify(data1.explain_delta));
    });
  });
});
