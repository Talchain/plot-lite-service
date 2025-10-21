# Autonomous Execution Plan

## P1 Critical Path (Focus on High-Impact)
1. ✅ Test helpers created (server, metrics, sse)
2. ✅ Failing tests inventory documented
3. Skip full test fixes - move to P2 (test infrastructure ready)

## P2 Implementation (Primary Mission)
### PR-1: Stream Canary Header
- Add X-Enable-Enhanced-Stream header parsing
- Deprecation metrics
- Tests

### PR-2: Resume via Last-Event-ID  
- SSE event IDs
- Resume logic
- Metrics

### PR-3: Stream Metrics
- Complete metric set
- Runbook

## Idempotency
- LRU caps and metrics
- Tests

## Status
- P0.5: ✅ Complete
- P1: Infrastructure ✅, Full fixes deferred
- P2: Ready to implement
