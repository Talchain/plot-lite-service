PLoT-lite Engine Evidence Pack
time: 2025-09-29T21:31:53Z
commit: 226ca6f
engine: http://127.0.0.1:4311
p95_ms: 35.3192080000008
lanes: typecheck=PASS, contracts=PASS, stream=PASS, security=PASS, perf=PASS, test=FAIL
checklist:
- ✅ Contracts (SSE events, report.v1 stamp, health shape)
- ✅ Stream (resume via Last-Event-ID, idempotent cancel)
- ✅ Security (no payload/query logs; headers; prod guard)
- ✅ Performance (p95 ≤ 600 ms; 429 Retry-After; limited SSE)
- ❌ Caching & taxonomy (ETag/304; HEAD parity; samples)
notes: UI not required; engine-only pack
out: /Users/paulslee/Documents/GitHub/plot-lite-service/artifact/Evidence-Pack-20250929-2226
