# Implementation Plan: P1-P2 Features

## Status: P0 Complete ✅

**Current Baseline:** 564/578 tests passing (97.6%)

---

## P1 — Option Compare View

### Goal
Provide deterministic sensitivity ranking per option using existing run artefacts (no extra sampling).

### Implementation Steps

#### 1. Create Sensitivity Analysis Module
**File:** `src/lib/sensitivity.ts`

```typescript
/**
 * Deterministic sensitivity ranking from existing Monte Carlo draws
 * 
 * Uses the masks and draws already produced for percentiles.
 * No extra sampling required.
 */

export interface SensitivityEdge {
  id: string;
  label?: string;
  weight: number;
  belief: number;
  provenance: string;
  rank: number;
}

export interface SensitivityResult {
  option_id: string;
  p10: number;
  p50: number;
  p90: number;
  top3_edges: SensitivityEdge[];
}

/**
 * Compute sensitivity ranking from existing draws
 * 
 * @param draws - Monte Carlo draws already computed
 * @param masks - Edge inclusion masks for each draw
 * @param edges - Graph edges with metadata
 * @param optionId - Target option node ID
 * @returns Sensitivity result with top-3 edges
 */
export function computeSensitivity(
  draws: number[],
  masks: boolean[][],
  edges: Array<{ id: string; label?: string; weight: number; belief?: number; provenance?: string }>,
  optionId: string
): SensitivityResult {
  // 1. Group draws by edge inclusion patterns
  // 2. Compute outcome variance when edge is included vs excluded
  // 3. Rank edges by variance contribution
  // 4. Stable tiebreak: edge id ascending
  // 5. Return top-3
  
  // Placeholder implementation
  const p10 = quantile(draws, 0.1);
  const p50 = quantile(draws, 0.5);
  const p90 = quantile(draws, 0.9);
  
  // TODO: Implement variance-based ranking
  const top3_edges: SensitivityEdge[] = edges
    .slice(0, 3)
    .map((e, i) => ({
      id: e.id,
      label: e.label,
      weight: e.weight,
      belief: e.belief || 1.0,
      provenance: e.provenance || 'template',
      rank: i + 1,
    }));
  
  return {
    option_id: optionId,
    p10,
    p50,
    p90,
    top3_edges,
  };
}

function quantile(arr: number[], q: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * q);
  return sorted[idx] || 0;
}
```

#### 2. Update Run Route Schema
**File:** `src/routes/v1/run.ts`

Add to `RunRequest`:
```typescript
export interface RunRequest {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
  inference_mode?: InferenceMode;
  include_debug?: boolean;  // NEW
}
```

Add to Fastify schema:
```typescript
properties: {
  // ... existing
  include_debug: { type: 'boolean' }
}
```

#### 3. Add Debug Slice to Response
**File:** `src/routes/v1/run.ts`

After computing results, if `include_debug === true && COMPARE_VIEW_ENABLE === '1'`:

```typescript
let debug: any = undefined;

if (body.include_debug && process.env.COMPARE_VIEW_ENABLE === '1') {
  // Extract draws and masks from SCM-Lite result
  const sensitivity = computeSensitivity(
    scmResult.draws,
    scmResult.masks,
    graph.edges,
    outcome_node
  );
  
  debug = {
    compare: {
      [outcome_node]: sensitivity
    }
  };
}

const base: any = {
  confidence,
  critique,
  ...(debug && { debug }),  // Only include if present
  explain_delta,
  graph,
  // ... rest
};
```

#### 4. Exclude Debug from Hash
**File:** `src/util/canonical-json.ts`

Update `stampResponseHash()`:
```typescript
export function stampResponseHash(report: any): any {
  const { debug, ...hashable } = report;  // Exclude debug
  const canonical = canonicalJSON(hashable);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return { ...report, model_card: { ...report.model_card, response_hash: hash } };
}
```

#### 5. Update Response Schema
**File:** `src/schemas/response.ts`

Add debug slice (optional):
```typescript
debug: {
  type: 'object',
  properties: {
    compare: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          option_id: { type: 'string' },
          p10: { type: 'number' },
          p50: { type: 'number' },
          p90: { type: 'number' },
          top3_edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                weight: { type: 'number' },
                belief: { type: 'number' },
                provenance: { type: 'string' },
                rank: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }
}
```

#### 6. Tests
**File:** `tests/option-compare.test.ts`

```typescript
describe('Option Compare View', () => {
  it('includes debug.compare when include_debug=true and flag enabled', async () => {
    const server = await spawnServer({
      env: { COMPARE_VIEW_ENABLE: '1', SCM_LITE_ENABLE: '1' }
    });
    
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({
        graph: CANONICAL_GRAPH,
        seed: 4242,
        include_debug: true
      })
    });
    
    expect(res.status).toBe(200);
    expect(res.data.debug).toBeDefined();
    expect(res.data.debug.compare).toBeDefined();
    expect(res.data.debug.compare[OUTCOME_NODE].top3_edges).toHaveLength(3);
  });
  
  it('omits debug.compare when include_debug=false', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({
        graph: CANONICAL_GRAPH,
        seed: 4242,
        include_debug: false
      })
    });
    
    expect(res.status).toBe(200);
    expect(res.data.debug).toBeUndefined();
  });
  
  it('top-3 edges are deterministic across runs', async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const res = await requestJSON(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        body: JSON.stringify({
          graph: CANONICAL_GRAPH,
          seed: 4242,
          include_debug: true
        })
      });
      runs.push(res.data.debug.compare[OUTCOME_NODE].top3_edges);
    }
    
    // All runs should have identical top-3
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
  });
  
  it('response_hash unchanged with/without include_debug', async () => {
    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({ graph: CANONICAL_GRAPH, seed: 4242, include_debug: false })
    });
    
    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({ graph: CANONICAL_GRAPH, seed: 4242, include_debug: true })
    });
    
    expect(r1.data.model_card.response_hash).toBe(r2.data.model_card.response_hash);
  });
});
```

### Acceptance Criteria
- ✅ Top-3 edges stable across re-runs with same (seed, k, mode)
- ✅ p10/p50/p90 match single-option results
- ✅ No added sampling; runtime delta ≤ 5%
- ✅ Contract tests: presence/absence guarded by `include_debug`
- ✅ `response_hash` stable with/without `include_debug`

---

## P1 — Inspector: Belief × Weight × Provenance

### Implementation Steps

#### 1. Update Graph Schema
**File:** `src/trust/types.ts`

```typescript
export interface Edge {
  from: string;
  to: string;
  weight: number;
  label?: string;
  condition?: string;
  belief?: number;      // NEW: 0-1 or 0-100%, normalise to 0-1
  provenance?: string;  // NEW: 'template' | 'user' | 'analysis' | ...
}
```

#### 2. Normalise Ingress
**File:** `src/middleware/input-validation.ts`

Add normalisation step:
```typescript
function normaliseEdges(edges: any[]): Edge[] {
  return edges.map(e => ({
    ...e,
    belief: normaliseBelief(e.belief),
    provenance: e.provenance || 'template'
  }));
}

function normaliseBelief(b: any): number {
  if (b === undefined || b === null) return 1.0;
  const num = Number(b);
  if (num > 1 && num <= 100) return num / 100;  // Assume percentage
  return Math.max(0, Math.min(1, num));  // Clamp to [0,1]
}
```

#### 3. Add Inspector Debug Slice
**File:** `src/routes/v1/run.ts`

```typescript
if (body.include_debug && process.env.INSPECTOR_DEBUG_ENABLE === '1') {
  debug = {
    ...debug,
    inspector: {
      edges: graph.edges.map(e => ({
        id: `${e.from}::${e.to}`,
        label: e.label,
        weight: e.weight,
        belief: e.belief || 1.0,
        provenance: e.provenance || 'template'
      }))
    }
  };
}
```

#### 4. Update OpenAPI
**File:** `contracts/openapi.yaml`

Add to request schema:
```yaml
include_debug:
  type: boolean
  description: Include debug slices (compare, inspector)
  default: false
```

Add to response schema:
```yaml
debug:
  type: object
  properties:
    compare:
      type: object
      description: Option sensitivity rankings
    inspector:
      type: object
      properties:
        edges:
          type: array
          items:
            type: object
            properties:
              id: { type: string }
              label: { type: string }
              weight: { type: number }
              belief: { type: number, minimum: 0, maximum: 1 }
              provenance: { type: string }
```

#### 5. Update UI Handoff
**File:** `docs/UI_Handoff_PLoT_v1.md`

Add section:
```markdown
### Inspector Fields (Debug Only)

When `include_debug: true` is set in the request, the response includes `debug.inspector.edges[]` with:

- **belief** (0-1): Chance the edge exists. Used to sample the on/off mask in Monte Carlo.
- **weight** (signed): Effect magnitude when the edge is on.
- **provenance** (string): Source of the edge ('template', 'user', 'analysis', etc.)

**Display:** Quantise to 2-3 decimal places. Show in a tooltip or inspector panel.

**Note:** Belief and weight play different roles—do not multiply them. Belief affects sampling; weight affects outcome when sampled.
```

#### 6. Tests
**File:** `tests/inspector.test.ts`

```typescript
describe('Inspector Debug Slice', () => {
  it('exposes belief/weight/provenance when include_debug=true', async () => {
    const server = await spawnServer({
      env: { INSPECTOR_DEBUG_ENABLE: '1', SCM_LITE_ENABLE: '1' }
    });
    
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [{ from: 'a', to: 'b', weight: 1.5, belief: 0.8, provenance: 'user' }]
        },
        include_debug: true
      })
    });
    
    expect(res.data.debug.inspector.edges).toHaveLength(1);
    expect(res.data.debug.inspector.edges[0].belief).toBe(0.8);
    expect(res.data.debug.inspector.edges[0].provenance).toBe('user');
  });
  
  it('normalises belief from percentage', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [{ from: 'a', to: 'b', weight: 1.0, belief: 80 }]  // 80%
        },
        include_debug: true
      })
    });
    
    expect(res.data.debug.inspector.edges[0].belief).toBe(0.8);
  });
  
  it('defaults missing belief to 1.0 and provenance to template', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [{ from: 'a', to: 'b', weight: 1.0 }]
        },
        include_debug: true
      })
    });
    
    expect(res.data.debug.inspector.edges[0].belief).toBe(1.0);
    expect(res.data.debug.inspector.edges[0].provenance).toBe('template');
  });
});
```

### Acceptance Criteria
- ✅ All edges populate belief/weight/provenance in debug slice
- ✅ No change to summary shape
- ✅ `response_hash` unaffected (debug excluded from hash)
- ✅ Validation permits optional fields; missing values normalise correctly

---

## P2 — Inference Modes Parity

### Implementation Steps

#### 1. Add Quantisation to Hash Function
**File:** `src/util/canonical-json.ts`

```typescript
function quantizeForHash(obj: any, dp: number = 4): any {
  if (typeof obj === 'number') {
    return Number(obj.toFixed(dp));
  }
  if (Array.isArray(obj)) {
    return obj.map(v => quantizeForHash(v, dp));
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = quantizeForHash(v, dp);
    }
    return result;
  }
  return obj;
}

export function stampResponseHash(report: any): any {
  const { debug, ...hashable } = report;
  const quantised = quantizeForHash(hashable, 4);  // 4 dp
  const canonical = canonicalJSON(quantised);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return { ...report, model_card: { ...report.model_card, response_hash: hash } };
}
```

#### 2. Parity Test
**File:** `tests/inference-modes-parity.test.ts`

```typescript
describe('Inference Modes Parity', () => {
  it('hash parity across modes after quantisation', async () => {
    const payload = {
      graph: CANONICAL_GRAPH,
      seed: 4242,
      k_samples: 1000
    };
    
    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, inference_mode: 'model_based' })
    });
    
    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, inference_mode: 'model_of_inference' })
    });
    
    expect(r1.data.model_card.response_hash).toBe(r2.data.model_card.response_hash);
  });
});
```

#### 3. Update Docs
**File:** `docs/UI_Handoff_PLoT_v1.md`

Add section:
```markdown
### Inference Modes

**`inference_mode`**: `'model_based'` | `'model_of_inference'` (default: `'model_based'`)

- **model_based**: Traditional causal inference. Recommended for most use cases.
- **model_of_inference**: Meta-level reasoning about the inference process itself. Use when you need to reason about uncertainty in the model structure.

Both modes produce deterministic results with the same seed and are hash-equivalent after 4-decimal-place quantisation.
```

### Acceptance Criteria
- ✅ Mode tests green
- ✅ Parity established on canonical template
- ✅ OpenAPI and UI handoff updated

---

## P2 — TypeScript SDK v0.1

### Structure
```
sdk/
  ts/
    src/
      client.ts
      types.ts
      events.ts
    examples/
      run-sync.ts
      run-stream.ts
    package.json
    tsconfig.json
    README.md
```

### Implementation
**File:** `sdk/ts/src/client.ts`

```typescript
export class PLoTClient {
  constructor(private baseUrl: string) {}
  
  async runSync(request: RunRequest): Promise<RunResponse> {
    const res = await fetch(`${this.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    return res.json();
  }
  
  async *runStream(request: RunRequest): AsyncGenerator<SSEEvent> {
    const res = await fetch(`${this.baseUrl}/v1/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          yield data;
          
          if (data.type === 'COMPLETE' || data.type === 'ERROR') {
            return;
          }
        }
      }
    }
  }
  
  async validate(graph: Graph): Promise<ValidateResponse> {
    const res = await fetch(`${this.baseUrl}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph })
    });
    
    return res.json();
  }
  
  async getLimits(): Promise<LimitsResponse> {
    const res = await fetch(`${this.baseUrl}/v1/limits`);
    return res.json();
  }
  
  async getTemplateGraph(id: string): Promise<TemplateGraphResponse> {
    const res = await fetch(`${this.baseUrl}/v1/templates/${id}/graph`);
    return res.json();
  }
}
```

### Acceptance Criteria
- ✅ SDK builds in CI
- ✅ Example app compiles and runs against local server
- ✅ No retries or sleeps in examples
- ✅ Proper close handling for SSE

---

## P2 — Performance and Soak Guardrails

### Tools
1. **`tools/perf/probe.mjs`**: Autocannon against `/v1/run` (canonical 12-node graph)
2. **`tools/perf/sse-soak.mjs`**: 60-120s SSE soak test

### Budgets to Publish in `/v1/limits`
```json
{
  "perf_budget_p95_ms": 600,
  "heartbeat_budget_ms": 5000,
  "sse_slot_max_ms": 120000
}
```

### Acceptance Criteria
- ✅ CI perf job passes (p95 ≤ 600ms)
- ✅ Soak tests stable locally (no leaks, single terminal event)
- ✅ `/v1/limits` exposes budgets

---

## P2 — Security and Limits Hardening

### Implementation
1. **CORS allowlist**: `http://localhost:5173`, `http://127.0.0.1:5173`
2. **Body limit**: JSON ≤ 1 MB (publish `maxBodyBytes`)
3. **Compute timeouts**: Cap `/v1/run` compute; `/v1/run/stream` slot timeout
4. **Rate limiting**: Ensure counters increment; 429 responses include headers
5. **Logging**: Scrub secrets and large payloads

### Tests
**File:** `tests/security.logging.test.ts`

```typescript
describe('Security: Logging', () => {
  it('does not log secrets', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    
    try {
      await requestJSON(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer secret-token-12345' },
        body: JSON.stringify({ graph: CANONICAL_GRAPH })
      });
      
      const allLogs = logs.join('\n');
      expect(allLogs).not.toContain('secret-token-12345');
    } finally {
      console.log = originalLog;
    }
  });
});
```

### Acceptance Criteria
- ✅ Dedicated tests pass
- ✅ `/v1/health` counters visible and correct
- ✅ No secret strings in captured logs

---

## Summary

**P0:** ✅ Complete (564/578 passing)  
**P1:** Ready to implement (feature flags added)  
**P2:** Implementation plan documented

**Next Action:** Implement P1 features in sequence, each as a focused PR with full test coverage.
