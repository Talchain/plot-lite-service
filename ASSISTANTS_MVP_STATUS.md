# Assistants MVP Integration - Status Report

**Branch:** `feat/assistants-in-engine`
**Status:** Foundation Complete (40% done)
**Next:** Follow ASSISTANTS_INTEGRATION_GUIDE.md to complete

---

## What's Been Created ✅

### 1. Core Infrastructure
- ✅ **Directory structure:** `src/assist/` with proper organization
- ✅ **Extended graph schema:** `src/assist/schemas/graph.ts`
  - Compatible with engine's base `Graph` type
  - Adds v04 metadata: version, seed, meta, node kinds
  - Conversion utilities for engine interop

### 2. Adapter Foundation
- ✅ **Type definitions:** `src/assist/adapters/llm/types.ts`
  - LLMAdapter interface
  - UsageMetrics, DraftGraphArgs/Result
  - Stream event types for SSE

### 3. Utilities
- ✅ **Fixtures:** `src/assist/utils/fixtures.ts`
  - Minimal buy-vs-build decision graph
  - Zero API cost, instant response
  - Enables testing without keys

- ✅ **Cost calculation:** `src/assist/utils/cost.ts`
  - OpenAI pricing (gpt-4o-mini: $0.15/$0.60 per 1M)
  - Anthropic pricing (claude-3-haiku: $0.25/$1.25 per 1M)
  - COST_MAX_USD guard implementation

### 4. Documentation
- ✅ **Integration guide:** `ASSISTANTS_INTEGRATION_GUIDE.md`
  - Step-by-step completion instructions
  - Copy/paste commands
  - Testing strategy
  - Troubleshooting section

---

## What Remains (See Integration Guide)

### Critical Path (Steps 1-11)

1. **Install dependencies** (5 min)
   - `npm install @anthropic-ai/sdk openai`

2. **Copy adapters** (10 min)
   - OpenAI adapter from standalone repo
   - Anthropic adapter from standalone repo
   - Create minimal router with fixtures fallback

3. **Create route handler** (15 min)
   - POST /assist/draft-graph (JSON)
   - POST /assist/draft-graph/stream (SSE)
   - Basic validation, cost guard

4. **Wire into server** (10 min)
   - Conditional registration (`ASSISTANTS_ENABLED=1`)
   - Update /health endpoint
   - Add env validation

5. **Add tests** (15 min)
   - Fixture-based tests (no API keys)
   - Integration tests
   - Live test script (`test:assist:live`)

6. **Create docs** (10 min)
   - docs/assistants-in-engine.md
   - Quick start, env vars, examples

**Estimated time to complete:** 60-90 minutes

---

## Testing Strategy

### Phase 1: Fixtures (No API Keys)
```bash
ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures npm run dev
curl http://localhost:4311/health
# Should show: assistants_enabled: true, provider: "fixtures"

curl -X POST http://localhost:4311/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Test"}'
# Should return fixture graph instantly
```

### Phase 2: OpenAI (Requires Key)
```bash
export ASSISTANTS_ENABLED=1
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-proj-...
npm run dev

curl -X POST http://localhost:4311/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Should we expand or focus?"}'
# Should return real LLM-generated graph
```

### Phase 3: Cost Guard
```bash
export COST_MAX_USD=0.0001  # Very low cap
# POST request should fail with COST_EXCEEDED
```

---

## Acceptance Criteria

**Must pass before merge:**

- [ ] ASSISTANTS_ENABLED=0 → no /assist/* routes exist
- [ ] ASSISTANTS_ENABLED=1 LLM_PROVIDER=fixtures → works without API keys
- [ ] /health shows {assistants_enabled, provider, model}
- [ ] POST /assist/draft-graph returns valid graph (≤12 nodes, ≤24 edges)
- [ ] Cost guard blocks requests exceeding COST_MAX_USD
- [ ] npm test passes without API keys
- [ ] test:assist:live works with OpenAI/Anthropic keys
- [ ] No regressions to existing engine routes
- [ ] Documentation complete and tested

---

## File Checklist

### Created ✅
- [x] src/assist/schemas/graph.ts
- [x] src/assist/adapters/llm/types.ts
- [x] src/assist/utils/fixtures.ts
- [x] src/assist/utils/cost.ts
- [x] ASSISTANTS_INTEGRATION_GUIDE.md
- [x] ASSISTANTS_MVP_STATUS.md (this file)

### Pending (from standalone repo)
- [ ] src/assist/adapters/llm/openai.ts
- [ ] src/assist/adapters/llm/anthropic.ts
- [ ] src/assist/adapters/llm/router.ts
- [ ] src/assist/routes/draft-graph.ts
- [ ] src/assist/utils/confidence.ts (optional for MVP)
- [ ] src/assist/services/clarifier.ts (optional for MVP)
- [ ] src/assist/services/docProcessing.ts (optional for MVP)
- [ ] src/assist/services/repair.ts (optional for MVP)
- [ ] tests/assist/draft-graph.test.ts
- [ ] docs/assistants-in-engine.md

### Modified (engine files)
- [ ] src/createServer.ts (add route registration + /health)
- [ ] package.json (add dependencies + test:assist scripts)

---

## Deployment Plan

### Local Development
1. Complete Steps 1-11 from integration guide
2. Test with fixtures (no keys)
3. Test with OpenAI key
4. Verify all acceptance criteria

### Staging (Render)
1. Deploy to staging environment
2. Add env vars:
   ```
   ASSISTANTS_ENABLED=1
   LLM_PROVIDER=openai
   OPENAI_API_KEY=***
   COST_MAX_USD=1.00
   ```
3. Verify /health shows assistants_enabled:true
4. Test POST /assist/draft-graph
5. Monitor costs and latency

### Rollback Plan
- Set `ASSISTANTS_ENABLED=0` → routes disappear instantly
- No service restart needed
- Engine continues working normally

---

## Risk Mitigation

**Low Risk (Mitigations in place):**
- ✅ Feature flag prevents impact when disabled
- ✅ Separate module, no engine code changes
- ✅ Cost guard prevents runaway API costs
- ✅ Fixtures enable testing without API keys
- ✅ Independent route namespace (/assist/*)

**Medium Risk (Monitor during rollout):**
- ⚠️ LLM latency may exceed 8s target → Use fixtures fallback at 2.5s
- ⚠️ API rate limits → Implement exponential backoff
- ⚠️ Memory usage → Monitor with real traffic

---

## Next Actions

**For you:**
1. Review this status doc and integration guide
2. Follow Steps 1-11 in ASSISTANTS_INTEGRATION_GUIDE.md
3. Test locally with fixtures
4. Test with OpenAI/Anthropic keys
5. Run full test suite
6. Commit and push to branch
7. Create PR when all acceptance criteria pass

**Estimated time:** 1-2 hours (depending on your familiarity with the codebase)

---

**Created by:** Claude Code Assistant
**Date:** 2025-11-03
**Branch:** feat/assistants-in-engine
**Ready for:** Systematic completion via integration guide
