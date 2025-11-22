PLoT-lite Engine Evidence Pack
time: 2025-09-28T15:22:23Z
commit: 0852b63
engine: http://127.0.0.1:4311
p95_ms: 2.3476249999985157
lanes: typecheck=PASS, contracts=PASS, stream=PASS, security=PASS, perf=PASS, test=PASS
checklist:
- ✅ Contracts (SSE events, report.v1 stamp, health shape)
- ✅ Stream (resume via Last-Event-ID, idempotent cancel)
- ✅ Security (no payload/query logs; headers; prod guard)
- ✅ Performance (p95 ≤ 600 ms; 429 Retry-After; limited SSE)
- ✅ Caching & taxonomy (ETag/304; HEAD parity; samples)
notes: UI not required; engine-only pack
out: /Users/paulslee/Documents/GitHub/plot-lite-service/artifact/Evidence-Pack-20250928-1620
