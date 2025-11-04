# Assistants MVP Integration Guide

**Status:** Foundation created (schemas, types, cost utils, fixtures)
**Next Steps:** Complete adapters → routes → server wiring → tests → docs

---

## What's Already Done ✅

- ✅ Branch: `feat/assistants-in-engine`
- ✅ Directory: `src/assist/` with proper structure
- ✅ `src/assist/schemas/graph.ts` - Extended graph types compatible with engine
- ✅ `src/assist/adapters/llm/types.ts` - Adapter interfaces
- ✅ `src/assist/utils/fixtures.ts` - Test fixtures (no API keys needed)
- ✅ `src/assist/utils/cost.ts` - Cost calculation + COST_MAX_USD guard

---

## Step 1: Add Dependencies

```bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service

npm install @anthropic-ai/sdk@^0.68.0 openai@^4.80.0
```

**Verify:**
```bash
grep -E "openai|anthropic" package.json
# Should show both packages
```

---

## Step 2: Copy OpenAI Adapter

**Source:** `/Users/paulslee/Documents/GitHub/olumi-assistants-service/src/adapters/llm/openai.ts`

**Destination:** `src/assist/adapters/llm/openai.ts`

**Changes needed:**
1. Update import paths:
   ```typescript
   import type { AssistGraph } from '../../schemas/graph.js';
   import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, ... } from './types.js';
   ```

2. Verify default model is `gpt-4o-mini` (should already be set)

3. No other changes needed - copy as-is

**Command:**
```bash
cp /Users/paulslee/Documents/GitHub/olumi-assistants-service/src/adapters/llm/openai.ts \
   /Users/paulslee/Documents/GitHub/plot-lite-service/src/assist/adapters/llm/openai.ts

# Then edit imports in the file
```

---

## Step 3: Copy Anthropic Adapter

**Source:** `/Users/paulslee/Documents/GitHub/olumi-assistants-service/src/adapters/llm/anthropic.ts`

**Destination:** `src/assist/adapters/llm/anthropic.ts`

**Changes needed:**
1. Update import paths (same as OpenAI)
2. Verify default model is `claude-3-haiku-20240307` (line ~700)
3. No other changes needed

**Command:**
```bash
cp /Users/paulslee/Documents/GitHub/olumi-assistants-service/src/adapters/llm/anthropic.ts \
   /Users/paulslee/Documents/GitHub/plot-lite-service/src/assist/adapters/llm/anthropic.ts
```

---

## Step 4: Create LLM Router (Minimal MVP)

**File:** `src/assist/adapters/llm/router.ts`

**Content:**
```typescript
/**
 * LLM Router - selects provider based on LLM_PROVIDER env
 * MVP: openai (default), anthropic, fixtures
 */

import type { LLMAdapter } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { fixtureGraph } from '../../utils/fixtures.js';

// Default: openai for cost-effectiveness
const DEFAULT_PROVIDER = process.env.LLM_PROVIDER || 'openai';

/**
 * Fixtures adapter (no API key needed)
 */
class FixturesAdapter implements LLMAdapter {
  readonly name = 'fixtures' as const;
  readonly model = 'fixture-v1';

  async draftGraph(_args: any, _opts: any): Promise<any> {
    return {
      graph: fixtureGraph,
      rationales: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  async suggestOptions(_args: any, _opts: any): Promise<any> {
    return {
      options: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  async repairGraph(args: any, _opts: any): Promise<any> {
    return {
      graph: args.graph,
      rationales: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}

/**
 * Get adapter for current provider
 */
export function getAdapter(): LLMAdapter {
  const provider = DEFAULT_PROVIDER;

  if (provider === 'openai') {
    return new OpenAIAdapter();
  } else if (provider === 'anthropic') {
    return new AnthropicAdapter();
  } else if (provider === 'fixtures') {
    return new FixturesAdapter();
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }
}
```

---

## Step 5: Create Minimal Route Handler

**File:** `src/assist/routes/draft-graph.ts`

**Content:**
```typescript
/**
 * POST /assist/draft-graph - Draft decision graph from brief (MVP)
 */

import type { FastifyInstance } from 'fastify';
import { getAdapter } from '../adapters/llm/router.js';
import { checkConstraints, toBaseGraph } from '../schemas/graph.js';
import { calculateCost, getCostCap, exceedsCostCap } from '../utils/cost.js';

export async function registerDraftGraphRoute(app: FastifyInstance) {
  // JSON endpoint
  app.post('/assist/draft-graph', async (request, reply) => {
    const { brief } = request.body as { brief: string };

    if (!brief || brief.length === 0) {
      return reply.code(400).send({
        error: { type: 'BAD_INPUT', message: 'Brief is required' }
      });
    }

    if (brief.length > 5000) {
      return reply.code(400).send({
        error: { type: 'BAD_INPUT', message: 'Brief too long (max 5000 chars)' }
      });
    }

    try {
      const adapter = getAdapter();
      const result = await adapter.draftGraph(
        { brief, seed: 17, docs: [] },
        { requestId: request.id, timeoutMs: 30000 }
      );

      // Check constraints
      const violations = checkConstraints(result.graph);
      if (violations.length > 0) {
        return reply.code(400).send({
          error: { type: 'VALIDATION_FAILED', message: 'Graph violates constraints', violations }
        });
      }

      // Check cost cap
      const cost = calculateCost(adapter.name, adapter.model, result.usage);
      const cap = getCostCap();
      if (exceedsCostCap(cost, cap)) {
        return reply.code(400).send({
          error: { type: 'COST_EXCEEDED', message: `Cost $${cost.toFixed(4)} exceeds cap $${cap.toFixed(2)}` }
        });
      }

      // Convert to engine base graph for validation
      const baseGraph = toBaseGraph(result.graph);
      // TODO: Call engine validator directly here

      return {
        graph: result.graph,
        rationales: result.rationales || [],
        confidence: 0.85,  // TODO: Calculate from clarifier
        cost_usd: cost,
      };
    } catch (error: any) {
      app.log.error({ error }, 'Draft graph failed');
      return reply.code(500).send({
        error: { type: 'INTERNAL', message: error.message || 'Internal error' }
      });
    }
  });

  // SSE endpoint (placeholder for MVP)
  app.post('/assist/draft-graph/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send DRAFTING event
    reply.raw.write(`event: stage\ndata: ${JSON.stringify({ stage: 'DRAFTING' })}\n\n`);

    // For MVP, just call regular draft-graph and send COMPLETE
    const { brief } = request.body as { brief: string };
    const adapter = getAdapter();
    const result = await adapter.draftGraph(
      { brief, seed: 17, docs: [] },
      { requestId: request.id, timeoutMs: 30000 }
    );

    const cost = calculateCost(adapter.name, adapter.model, result.usage);

    reply.raw.write(`event: complete\ndata: ${JSON.stringify({
      graph: result.graph,
      cost_usd: cost
    })}\n\n`);

    reply.raw.end();
  });
}
```

---

## Step 6: Wire into createServer.ts

**File:** `src/createServer.ts`

**Add after line ~360 (near /health endpoint):**

```typescript
// Assistants module (conditional registration)
if (process.env.ASSISTANTS_ENABLED === '1') {
  const { registerDraftGraphRoute } = await import('./assist/routes/draft-graph.js');
  await registerDraftGraphRoute(app);

  app.log.info({
    assistants_enabled: true,
    provider: process.env.LLM_PROVIDER || 'openai',
  }, 'Assistants module enabled');
}
```

**Update /health endpoint (around line ~365):**

```typescript
app.get('/health', async () => {
  const health: any = {
    ok: true,
    service: 'plot-engine',
    uptime_s: Math.floor(process.uptime()),
  };

  // Add assistants info if enabled
  if (process.env.ASSISTANTS_ENABLED === '1') {
    const { getAdapter } = await import('./assist/adapters/llm/router.js');
    const adapter = getAdapter();
    health.assistants_enabled = true;
    health.provider = adapter.name;
    health.model = adapter.model;
  } else {
    health.assistants_enabled = false;
  }

  return health;
});
```

---

## Step 7: Environment Validation

**File:** `src/createServer.ts`

**Add near top of createServer() function (after line ~45):**

```typescript
// Validate Assistants configuration if enabled
if (process.env.ASSISTANTS_ENABLED === '1') {
  const provider = process.env.LLM_PROVIDER || 'openai';

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('ASSISTANTS_ENABLED=1 with LLM_PROVIDER=openai requires OPENAI_API_KEY');
  }

  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ASSISTANTS_ENABLED=1 with LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
}
```

---

## Step 8: Add Test Script

**File:** `package.json`

**Add to scripts section:**

```json
{
  "scripts": {
    ...existing scripts...,
    "test:assist": "ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures npm test",
    "test:assist:live": "ASSISTANTS_ENABLED=1 LIVE_LLM=1 npm test"
  }
}
```

---

## Step 9: Create Minimal Test

**File:** `tests/assist/draft-graph.test.ts`

**Content:**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Assistants /assist/draft-graph', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ASSISTANTS_ENABLED = '1';
    process.env.LLM_PROVIDER = 'fixtures';
    app = await createServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns fixture graph without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assist/draft-graph',
      payload: { brief: 'Should we expand or focus?' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.graph).toBeDefined();
    expect(body.graph.nodes).toHaveLength(5);
    expect(body.cost_usd).toBe(0);  // Fixtures have zero cost
  });

  it('rejects empty brief', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assist/draft-graph',
      payload: { brief: '' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('/health with assistants', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ASSISTANTS_ENABLED = '1';
    process.env.LLM_PROVIDER = 'fixtures';
    app = await createServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows assistants_enabled:true and provider info', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistants_enabled).toBe(true);
    expect(body.provider).toBe('fixtures');
    expect(body.model).toBe('fixture-v1');
  });
});
```

---

## Step 10: Create Documentation

**File:** `docs/assistants-in-engine.md`

**Content:**

```markdown
# Assistants Module (In-Process)

Assistants provides NL→Graph drafting endpoints directly within the PLoT engine.

## Quick Start

### 1. Install Dependencies

\`\`\`bash
npm install @anthropic-ai/sdk@^0.68.0 openai@^4.80.0
\`\`\`

### 2. Configure Environment

\`\`\`bash
# Enable assistants
export ASSISTANTS_ENABLED=1

# Choose provider (openai is default for cost-effectiveness)
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-proj-...

# Or use Anthropic
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Cost protection
export COST_MAX_USD=1.00
\`\`\`

### 3. Start Server

\`\`\`bash
npm run dev
\`\`\`

### 4. Test Endpoint

\`\`\`bash
# Check health
curl http://localhost:4311/health
# Should show: { ok: true, assistants_enabled: true, provider: "openai", ... }

# Draft a graph
curl -X POST http://localhost:4311/assist/draft-graph \\
  -H "Content-Type: application/json" \\
  -d '{"brief":"Should we expand internationally or focus on domestic growth?"}'
\`\`\`

## Disable Assistants

\`\`\`bash
export ASSISTANTS_ENABLED=0
# Routes disappear immediately, engine unaffected
\`\`\`

## Testing

\`\`\`bash
# Without API keys (uses fixtures)
npm run test:assist

# With real LLM calls (requires API keys)
npm run test:assist:live
\`\`\`

## Render Deployment

Add to your existing engine service (same dyno):

\`\`\`
ASSISTANTS_ENABLED=1
LLM_PROVIDER=openai
OPENAI_API_KEY=***
COST_MAX_USD=1.00
\`\`\`

No new service needed - routes added to existing `/health`, `/draft-flows`, etc.

## API Reference

### POST /assist/draft-graph

**Request:**
\`\`\`json
{
  "brief": "Should we migrate to microservices?"
}
\`\`\`

**Response:**
\`\`\`json
{
  "graph": {
    "version": "1",
    "default_seed": 17,
    "nodes": [...],
    "edges": [...],
    "meta": { "roots": [...], "leaves": [...] }
  },
  "rationales": [...],
  "confidence": 0.85,
  "cost_usd": 0.0012
}
\`\`\`

### POST /assist/draft-graph/stream (SSE)

Same request, streams events:
- `event: stage` → DRAFTING
- `event: complete` → final graph

## Cost Defaults

- **OpenAI gpt-4o-mini:** ~$0.001/request (default)
- **Anthropic claude-3-haiku:** ~$0.002/request
- **COST_MAX_USD=1.00:** Blocks requests exceeding cap
\`\`\`

---

## Step 11: Run Tests

\`\`\`bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service

# Build
npm run build

# Test with fixtures (no API keys)
ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures npm test

# Test locally with dev server
ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures npm run dev
# Then: curl http://localhost:4311/health
\`\`\`

---

## Acceptance Checklist

- [ ] `ASSISTANTS_ENABLED=0` → no `/assist/*` routes
- [ ] `ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures` → routes work without API keys
- [ ] `/health` shows `assistants_enabled`, `provider`, `model`
- [ ] `POST /assist/draft-graph` returns valid graph
- [ ] Cost guard blocks requests > COST_MAX_USD
- [ ] Tests pass without API keys
- [ ] With `OPENAI_API_KEY` set → real OpenAI calls work
- [ ] With `ANTHROPIC_API_KEY` set → real Anthropic calls work

---

## Optional Enhancements (Later)

1. **Services:** Add `clarifier.ts`, `docProcessing.ts`, `repair.ts` from standalone repo
2. **Validation:** Call engine's graph validator directly (in-process, no HTTP)
3. **Streaming:** Emit fixture at 2.5s, stream partial progress
4. **Telemetry:** Integrate with engine's metrics system
5. **Endpoints:** Add `/assist/suggest-options`, `/assist/explain-diff`

---

## Troubleshooting

**"ASSISTANTS_ENABLED=1 but routes don't appear"**
- Check server logs for errors during import
- Verify `src/assist/routes/draft-graph.ts` exists
- Ensure no TypeScript errors: `npm run typecheck`

**"Unknown provider: openai"**
- Install dependencies: `npm install openai @anthropic-ai/sdk`
- Check `src/assist/adapters/llm/openai.ts` exists

**"Cost exceeded"**
- Increase COST_MAX_USD or optimize prompt size
- Use fixtures provider for testing: `LLM_PROVIDER=fixtures`

---

**Created:** 2025-11-03
**Status:** MVP foundation ready - complete Steps 1-11 to finish integration
