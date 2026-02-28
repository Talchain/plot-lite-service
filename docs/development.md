# Development Guide

## Prerequisites

- **Node.js**: 20 LTS (use `nvm use`)
- **npm**: 10.x (comes with Node 20)
- **zip**: Required for `tools/pack-engine.mjs`
- **Python 3**: Optional, for Python SDK smoke tests

## Setup

```bash
# Switch to correct Node version
nvm use

# Install dependencies (clean install)
npm ci --no-fund --no-audit

# Verify setup
npm run diag
```

## Development Workflow

### Start Development Server

```bash
npm run dev
```

Server runs at http://localhost:4311 with hot reload.

### Run Tests

```bash
# All tests
npm test

# Specific test file
npx vitest run tests/health.test.ts

# Watch mode
npx vitest watch
```

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
plot-lite-service/
├── src/
│   ├── routes/v1/      # API endpoints
│   ├── engine/         # Core inference logic
│   ├── cee/            # CEE integration
│   ├── trust/          # Confidence & insights
│   ├── contracts/      # Type definitions
│   ├── middleware/     # Request handling
│   └── createServer.ts # Server setup
├── tests/              # Test files
│   ├── engine/         # Engine tests
│   ├── adapters/       # Adapter harnesses
│   └── *.test.ts       # Feature tests
├── contracts/
│   └── openapi.yaml    # API specification
├── fixtures/           # Deterministic test fixtures
├── docs/               # Documentation
├── tools/              # Build & verification tools
└── packages/           # SDKs
    ├── olumi-plot-sdk/ # TypeScript SDK
    └── plot-sdk-py/    # Python SDK
```

## Testing

### Test Categories

| Pattern | Description |
|---------|-------------|
| `*.test.ts` | Unit and integration tests |
| `*.demo.*.test.ts` | Demo-mode tests |
| `engine/*.cjs` | Engine calculation tests |

### Running Specific Tests

```bash
# Health and readiness
npx vitest run tests/health.test.ts

# OpenAPI compliance
npx vitest run tests/openapi*.test.ts

# Stream tests
npx vitest run tests/stream*.test.ts

# SDK tests
npx vitest run tests/sdk*.test.ts
```

### Determinism Verification

```bash
# Start server first
npm run build && npm start &

# Run replay fixtures
node tools/replay-fixtures.js
# Expected: "All fixtures match (N cases)."
```

## Code Quality

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npm run typecheck
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `chore:` Maintenance
- `test:` Test changes

Enforced by commitlint + husky hooks.

## Verification Gates

Run the full verification block:

```bash
npm run build
npx vitest run tests/*openapi*test.ts tests/*health*test.ts --reporter=dot
npm run pack:engine
node tools/gates-status.mjs
```

### Gate Scripts

| Script | Purpose |
|--------|---------|
| `openapi-lint-gate.mjs` | OpenAPI spec validation |
| `stream-chaos-halfclose-gate.mjs` | SSE resilience |
| `ttff-sample-gate.mjs` | Time-to-first-frame SLO |
| `runtime-consistency-gate.mjs` | Determinism check |
| `provenance-gate.mjs` | Artifact integrity |

Output format:
- `GATES: PASS — ...` = Success
- `GATES: FAIL — ...` = Failure (non-zero exit)
- `GATES: SKIP — ...` = Not applicable

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4311 | Server port |
| `NODE_ENV` | development | Environment |
| `AUTH_ENABLED` | 0 | Enable auth |
| `AUTH_TOKEN` | - | Bearer token |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | 1 | Enable rate limiting |
| `RATE_LIMIT_RPM` | 60 | Requests per minute |

### Features

| Variable | Default | Description |
|----------|---------|-------------|
| `SCM_LITE_ENABLE` | 0 | SCM-Lite mode |
| `FEATURE_STREAM` | 0 | Enable SSE streaming |
| `ADAPTIVE_K_ENABLE` | 0 | Adaptive sampling |
| `TEST_ROUTES` | 0 | Enable test endpoints |

### CEE Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_BASE_URL` | - | CEE service URL |
| `CEE_API_KEY` | - | CEE API key |
| `CEE_ORCHESTRATOR_ENABLED` | 0 | Enable CEE |

## Debugging

### Enable Debug Logging

```bash
DEBUG=plot:* npm run dev
```

### Request Tracing

Include `X-Request-Id` header:
```bash
curl -H "X-Request-Id: debug-123" http://localhost:4311/v1/run ...
```

### Health Check

```bash
curl http://localhost:4311/health | jq
```

## Release Process

### Version Bump

```bash
# Patch release (0.0.X)
npm run release

# Minor release (0.X.0)
npm run release:minor

# Major release (X.0.0)
npm run release:major
```

### Release Checklist

1. All tests passing
2. Gates passing
3. CHANGELOG.md updated
4. Version bumped
5. Tag pushed
6. GitHub Release created

See [RELEASING.md](../RELEASING.md) for details.

## Docker

### Build and Run

```bash
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```

### Docker Compose

```bash
docker compose up --build
```

Runs app + tests service with health checks.

## CI/CD

### GitHub Actions

- **PR checks**: Tests on Node 18/20, linting, gates
- **Release workflow**: Builds, tests, creates GitHub Release
- **Nightly**: Evidence pack generation

### Artifacts

- `reports/tests.json` - Test results
- `docs/collections/plot-lite.postman.json` - Postman collection
- `artifact/engine_pack_*.zip` - Engine artifact

## Troubleshooting

### Port Already in Use

```bash
lsof -i :4311 | grep LISTEN
kill -9 <PID>
```

### Tests Failing

1. Check Node version: `node -v` (should be 20.x)
2. Clean install: `rm -rf node_modules && npm ci`
3. Check server not running: `curl http://localhost:4311/health`

### Determinism Mismatch

1. Verify same seed is used
2. Check for floating-point operations
3. Run `npm run diag` for diagnostics
