# PLoT Engine — Developer Guide

**Version**: v1.0  
**Last Updated**: 2025-10-23

---

## Quick Start

### Prerequisites
- **Node**: v20.19.5
- **npm**: 10.8.2

### Setup
```bash
git clone <repo-url>
cd plot-lite-service
npm ci
npm run build
npm test
```

---

## Project Structure

```
plot-lite-service/
├── src/
│   ├── routes/v1/          # API endpoints
│   ├── lib/                # Utilities (SSE, JCS, etc.)
│   ├── middleware/         # Auth, validation, rate-limit
│   ├── errors.ts           # Error helpers (error.v1 envelope)
│   └── metrics.ts          # Prometheus metrics
├── tests/                  # Test suite
├── docs/                   # Documentation
└── tools/                  # CI scripts
```

---

## Running Locally

### Start Server
```bash
npm run build
PORT=3500 AUTH_ENABLED=0 node dist/main.js
```

### Run Tests
```bash
# All tests
npm test

# Specific test file
npx vitest run tests/p2-1-canary.test.ts

# Watch mode
npx vitest watch
```

### Check Coverage
```bash
npx vitest run --coverage
```

---

## Key Endpoints

### `/v1/run` — Execute PLoT Engine
```bash
curl -X POST http://localhost:3500/v1/run \
  -H "Content-Type: application/json" \
  -d '{"seed": 1337, "template_id": "pricing@v1"}'
```

### `/v1/stream` — SSE Stream
```bash
curl -N "http://localhost:3500/v1/stream?demo=1"
```

### `/v1/limits` — Scope Limits (Cached)
```bash
curl http://localhost:3500/v1/limits
```

### `/v1/health` — Health Check
```bash
curl http://localhost:3500/v1/health
```

### `/metrics` — Prometheus Metrics
```bash
PORT=3500 PROMETHEUS_ENABLE=1 node dist/main.js &
curl http://localhost:3500/metrics
```

---

## Trust Signals (CEE & Provenance)

### CEE Severity Classification

- CEE Decision Review is gated by `CEE_ORCHESTRATOR_ENABLE` and Idempotency-Key on `/v1/run`.
- The CEE client normalises error codes into semantic severities:
  - `error` – blocking issues (e.g. `LIMIT_EXCEEDED`, `CIRCULAR_DEPENDENCY`).
  - `warning` – non-blocking issues worth review (e.g. `MISSING_EVIDENCE`, `LOW_CONFIDENCE`).
  - `info` – suggestions and contextual nudges (e.g. `CONSIDER_CONFOUNDER`).
- Helpers live in `src/cee/severity.ts` and are re-exported from `src/cee/index.ts`:
  - `classifyCeeSeverity(code)` → `'error' | 'warning' | 'info'`.
  - `isBlockingError(code)` → `true` for blocking issues.
  - `describeSeverity(severity)` → human-readable description for UI/logging.
- Unknown codes default to `warning` for safety.

Run the standalone example:
```bash
npx tsx examples/cee-severity.ts
```

### Provenance Summary & Confidence

- When `PROVENANCE_ENABLE=1`, `/v1/run` attaches `model_card.provenance_summary`.
- Summary is derived from `src/trust/provenance.ts` and includes:
  - `sources` / `source_count` – unique external provenance labels.
  - `edges_with_provenance` / `edges_total` – coverage counts.
  - `coverage_ratio` – proportion of edges with external evidence.
  - `confidence_level` – `LOW | MEDIUM | HIGH | UNKNOWN`.
  - `confidence_score` – 0–1 provenance quality score.
  - `collected_at` – ISO 8601 timestamp.
- Assumption-only labels (`template`, `assumption`) are treated as non-evidence and excluded from coverage.

Inspect a provenance summary using the helper directly:
```bash
npx tsx examples/provenance-tracking.ts
```

### Evidence Freshness Tracking

- When a `/v1/run` request includes an `evidence[]` array, the engine summarises evidence recency into `model_card.evidence_freshness`.
- The summary shape (see `src/trust/evidence-freshness.ts`) is:

```ts
model_card: {
  // ...
  evidence_freshness?: {
    total: number;              // total evidence items
    with_timestamp: number;     // items with a valid timestamp
    oldest_days: number | null; // age (days) of the oldest dated item
    newest_days: number | null; // age (days) of the newest dated item
    buckets: {
      FRESH: number;   // 0–90 days old
      AGING: number;   // 91–364 days old
      STALE: number;   // 365+ days old
      UNKNOWN: number; // missing or invalid timestamp
    };
  };
}
```

- Buckets are computed from evidence `timestamp` fields (ISO 8601 strings). Invalid or missing timestamps are treated as `UNKNOWN`.
- This summary is intended for **data quality transparency** rather than hard gating: UI clients can surface badges and warnings without re-implementing the logic.

Example usage in a client:

```ts
const freshness = response.model_card?.evidence_freshness;
if (freshness && freshness.total > 0) {
  const freshRatio = freshness.buckets.FRESH / freshness.total;

  if (freshRatio >= 0.7) {
    showQualityBadge('High quality evidence', 'green');
  }

  if (freshness.oldest_days != null && freshness.oldest_days >= 365) {
    showWarning('Some evidence may be stale – consider refreshing key inputs');
  }
}
```

In addition, the critique system may emit a `STALE_EVIDENCE` item (severity `IMPROVEMENT`, semantic severity `WARNING`) when stale evidence is present at standard detail level; this is intentionally skipped for `detail_level = 'quick'`.

---

## Environment Variables

### Core
- `PORT` — Server port (default: 3000)
- `AUTH_ENABLED` — Enable auth (0=off, 1=on)
- `AUTH_TOKEN` — Bearer token for auth

### Features
- `PROMETHEUS_ENABLE` — Enable /metrics (0=off, 1=on)
- `TRACE_MIN` — Add trace_id to responses (0=off, 1=on)
- `STREAM_PARITY_ENABLE` — Use enhanced stream (0=off, 1=on)

### Rate Limiting
- `RATE_LIMIT_ENABLED` — Enable rate limiting (0=off, 1=on)
- `RATE_LIMIT_MAX` — Max requests per window (default: 100)

### SSE
- `SSE_RETRY_MS` — Retry interval (default: 1500)
- `SSE_HEARTBEAT_MS` — Heartbeat interval (default: 15000)

---

## Testing

### Test Categories
- **Unit**: `tests/*.test.ts` — Fast, isolated
- **Integration**: `tests/*.int.test.ts` — Full server
- **E2E**: Manual smoke tests

### Running Specific Tests
```bash
# P2-1 canary tests
npx vitest run tests/p2-1-canary.test.ts

# Determinism tests
npx vitest run tests/p2-determinism.test.ts

# ETag caching tests
npx vitest run tests/l1-limits.test.ts
```

### Test Baseline
Current baseline (2025-10-23):
- **18 failed files** (A2 taxonomy migration, tracked)
- **153 passed files**
- **8 skipped files**

See `TRACKING_ISSUE_A2_TAXONOMY.md` for details.

---

## Proofs & Verification

### Determinism (5× Identical Hash)
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

for i in {1..5}; do 
  curl -s "http://localhost:3500/v1/run?seed=1337" | \
    jq -r '.model_card.response_hash'
done | sort | uniq -c

# Expected: 5 identical hashes

kill %1
```

### ETag Caching (200 → 304)
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

ETAG=$(curl -sD - http://localhost:3500/v1/limits -o /dev/null | \
  awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
echo "ETag: $ETAG"

curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -H "If-None-Match: $ETAG" http://localhost:3500/v1/limits

# Expected: Status: 304

kill %1
```

### SSE Hygiene (Retry + Heartbeats)
```bash
PORT=3500 AUTH_ENABLED=0 node dist/main.js &
sleep 2

# Check retry line
curl -i "http://localhost:3500/v1/stream?demo=1" | head -20

# Sample heartbeats
timeout 20 curl -s "http://localhost:3500/v1/stream?demo=1" | \
  grep -m1 ":keepalive"

kill %1
```

### Stream Canary Metrics
```bash
PORT=3500 PROMETHEUS_ENABLE=1 AUTH_ENABLED=0 node dist/main.js &
sleep 2

curl -H "X-Enable-Enhanced-Stream: 1" \
  "http://localhost:3500/v1/stream?demo=1" > /dev/null

curl -s http://localhost:3500/metrics | \
  grep -E "plot_engine_stream_(canary|deprecated_header)_total"

kill %1
```

---

## Branch & Commit Rules

### Branch Naming
- `feat/<name>` — New features
- `fix/<name>` — Bug fixes
- `docs/<name>` — Documentation only
- `test/<name>` — Test additions

### Commit Messages (Conventional Commits)
```
feat(p2-1): add stream canary header + metrics
fix(a2): update error taxonomy to error.v1
docs: add developer onboarding guide
test: add determinism 5× proof
```

### PR Rules
- ✅ One feature/fix per PR
- ✅ Tests pass (or match baseline)
- ✅ Proofs included in PR body
- ✅ Reference tracking issues for inherited failures
- ✅ No `src/*.js` artifacts tracked

---

## Quality Gates

### Pre-Commit
```bash
# No artifacts
git ls-files | grep '^src/.*\.js$' || echo "✅ OK"

# Build succeeds
npm run build

# Tests pass
npm test
```

### Pre-Merge
```bash
# Working tree clean
git status --porcelain

# No new failures vs baseline
npx vitest run | grep "Test Files"

# Proofs pass
./run-gates.sh <branch> <gate>
```

---

## Troubleshooting

### Build Fails
```bash
# Clean and rebuild
rm -rf dist node_modules
npm ci
npm run build
```

### Tests Fail
```bash
# Check baseline
cat TRACKING_ISSUE_A2_TAXONOMY.md

# Run specific test
npx vitest run tests/<file>.test.ts --reporter=verbose
```

### Server Won't Start
```bash
# Check port availability
lsof -i :3500

# Check logs
PORT=3500 AUTH_ENABLED=0 node dist/main.js 2>&1 | tee server.log
```

---

## Documentation

### Key Documents
- `AUTONOMOUS_STABILISATION_EXECUTION.md` — Current execution plan
- `TRACKING_ISSUE_A2_TAXONOMY.md` — Known test failures
- `PHASE1_EXECUTION_SUMMARY.md` — Safe PRs ready to open
- `T1_T2_IMPLEMENTATION_GUIDE.md` — SSE integration + schemas
- `GATE_VALIDATION_REPORT.md` — Quality gates
- `PR_BODIES.md` — PR templates

### API Documentation
- `/openapi.json` — OpenAPI 3.1 spec (when available)
- `/schemas/*.json` — JSON schemas (when available)
- `docs/feature-*.md` — Feature specifications

---

## Getting Help

### Common Issues
1. **18 failed tests**: Expected, tracked in `TRACKING_ISSUE_A2_TAXONOMY.md`
2. **Build artifacts**: Never commit `src/*.js` files
3. **Rate limit tests**: May be flaky, see tracking issue

### Resources
- **Baseline Log**: `BASELINE_TEST_RUN_20251023_144203.log`
- **Tracking Issue**: `TRACKING_ISSUE_A2_TAXONOMY.md`
- **Execution Plan**: `AUTONOMOUS_STABILISATION_EXECUTION.md`

---

**Last Updated**: 2025-10-23 14:50 UTC+01:00
