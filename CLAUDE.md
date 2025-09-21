# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server with watch mode (tsx watch src/main.ts)
- `npm run build` - Build TypeScript (compiles both src and tools)
- `npm start` - Start production server (node dist/main.js)
- `npm test` - Run all tests via tools/run-all-tests.js

### Testing & Quality Assurance
- `npm run replay` - Run determinism harness (tools/replay-fixtures.js) - should output "All fixtures match"
- `npm run loadcheck` - Performance testing (tools/loadcheck.js) - target p95 ≤ 600ms
- `npm run ci` - Full CI pipeline (npm ci && npm run build && npm test)

### Release Management
- `npm run release` - Create patch release with conventional commits
- `npm run release:minor` - Create minor release
- `npm run release:major` - Create major release

## Architecture Overview

This is a **deterministic Fastify + TypeScript service** for PLoT-lite that returns fixed responses from fixtures rather than making AI calls. The service prioritizes determinism, privacy, and performance.

### Core Design Principles
- **Deterministic responses**: All POST endpoints return pre-serialized fixture data
- **Privacy-first**: Never logs parse_text or request body contents - only structured logs (request ID, route, status, duration)
- **Rate limiting**: Per-IP requests limited per minute (configurable, default 60 RPM)
- **Idempotency**: Optional Idempotency-Key header support with 10-minute cache TTL

### Key Components

#### Server Architecture
- **src/main.ts**: Entry point with graceful shutdown, health snapshots (SIGUSR2), and process management
- **src/createServer.ts**: Main Fastify server factory with middleware setup, route definitions, and idempotency cache
- **src/rateLimit.ts**: Per-IP rate limiting with exemptions for health endpoints
- **src/metrics.ts**: Performance monitoring (p95/p99 response times, event loop delay)

#### Core Endpoints
- **GET /health**: Comprehensive health check with metrics, runtime info, cache status
- **GET /version**: API version and build info
- **POST /draft-flows**: Returns deterministic fixtures (fixture_case parameter supported)
- **POST /critique**: Returns fixed critique rules via Ajv validation
- **POST /improve**: Echoes parse_json and returns empty fix_applied array

#### Testing & Tools
- **tools/run-all-tests.ts**: Test runner that starts server, runs Vitest, validates OpenAPI responses
- **tools/replay-fixtures.ts**: Determinism validation ensuring byte-for-byte response equality
- **tools/loadcheck.ts**: Performance testing with autocannon

### TypeScript Configuration
- **tsconfig.json**: Main source compilation (src/**/*.ts → dist/)
- **tsconfig.tools.json**: Tools compilation (tools/, lib/ → root level .js files)
- Uses ES2022 target with NodeNext modules for Node 20 compatibility

### Environment Configuration
- **PORT**: Service port (default 4311)
- **RATE_LIMIT_ENABLED**: Enable rate limiting (default 1, set 0 to disable)
- **RATE_LIMIT_RPM**: Requests per minute per IP (default 60)
- **REQUEST_TIMEOUT_MS**: Request timeout (default 5000ms)
- **CORS_DEV**: Enable CORS for localhost:5173 in development

### Development Notes
- Service runs on http://localhost:4311
- All responses are deterministic and pre-computed from fixtures/
- Conventional commits enforced via commitlint + husky
- OpenAPI schema validation available in development
- Docker support with healthcheck and multi-stage testing

### Privacy & Security
- Structured logging with parse_text redaction
- No sensitive data logging
- Request/response bodies never logged
- Rate limiting with proper HTTP headers (X-RateLimit-*, Retry-After)