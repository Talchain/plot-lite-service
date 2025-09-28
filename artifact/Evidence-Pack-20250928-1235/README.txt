PLoT-lite Engine Evidence Pack
time: 2025-09-28T11:38:07Z
commit: 6de4f0e
engine: http://127.0.0.1:4311
p95_ms: 3.444208000000799
lanes: typecheck=PASS, contracts=PASS, stream=PASS, security=PASS, perf=PASS, test=PASS
checklist:
- ✅ Contracts (SSE events, report.v1 stamp, health shape)
- ✅ Stream (resume via Last-Event-ID, idempotent cancel)
- ✅ Security (no payload/query logs; headers; prod guard)
- ✅ Performance (p95 ≤ 600 ms; 429 Retry-After; limited SSE)
- ✅ Caching & taxonomy (ETag/304; HEAD parity; samples)
notes: UI not required; engine-only pack
out: /Users/paulslee/Documents/GitHub/plot-lite-service/artifact/Evidence-Pack-20250928-1235
