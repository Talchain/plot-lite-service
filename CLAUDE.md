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
- **Multi-tier rate limiting**: Organization > User > IP level limits with configurable burst/sustained rates
- **Response caching**: L1 (memory) + optional L2 (Redis) caching with singleflight and tag-based invalidation
- **Idempotency**: Optional Idempotency-Key header support with 10-minute cache TTL

### Key Components

#### Server Architecture
- **src/main.ts**: Entry point with graceful shutdown, health snapshots (SIGUSR2), and process management
- **src/createServer.ts**: Main Fastify server factory with middleware setup, route definitions, idempotency cache, and response caching
- **src/limit/plugin.ts**: Multi-tier rate limiting (org/user/IP) with token bucket algorithm
- **src/cache/index.ts**: Response cache manager with L1/L2 support and singleflight
- **src/cache/key.ts**: Cache key generation with org/user context and tag-based invalidation
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

#### Core Settings
- **PORT**: Service port (default 4311)
- **REQUEST_TIMEOUT_MS**: Request timeout (default 5000ms)
- **CORS_DEV**: Enable CORS for localhost:5173 in development
- **TRUST_PROXY**: Honor X-Forwarded-For header (default 0)

#### Rate Limiting (disabled by default)
- **RATE_LIMIT_ENABLED**: Enable rate limiting (default 0, set 1 to enable)
- **RL_IP_BURST**: IP-level burst limit (default 120)
- **RL_IP_SUSTAINED_PER_MIN**: IP-level sustained rate (default 600)
- **RL_USER_BURST**: User-level burst limit (default 180)
- **RL_USER_SUSTAINED_PER_MIN**: User-level sustained rate (default 900)
- **RL_ORG_BURST**: Organization-level burst limit (default 300)
- **RL_ORG_SUSTAINED_PER_MIN**: Organization-level sustained rate (default 1500)

#### Response Caching (disabled by default)
- **CACHE_ENABLED**: Enable response caching (default 0, set 1 to enable)
- **CACHE_DRAFT_FLOWS_TTL_MS**: /draft-flows cache TTL (default 300000 = 5 minutes)
- **CACHE_CRITIQUE_TTL_MS**: /critique cache TTL (default 600000 = 10 minutes)
- **CACHE_L1_MAX_KEYS**: L1 memory cache max entries (default 1000)
- **CACHE_MAX_BODY_BYTES**: Max request body size to cache (default 32768 = 32KB)
- **UPSTASH_REDIS_REST_URL**: Optional L2 Redis cache URL
- **UPSTASH_REDIS_REST_TOKEN**: Optional L2 Redis cache token

### Rate Limiting Strategy
- **Organization-level**: Highest priority when `x-org-id` header present
- **User-level**: When `x-user-id` header present (no org header)
- **IP-level**: Fallback when no org/user headers
- **Protected endpoints**: All POST routes (/draft-flows, /critique, /improve)
- **Exempt endpoints**: GET /health, /version, /live, /ops/snapshot
- **Headers**: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (on 429)

### Response Caching Strategy
- **L1 (Memory)**: Fast in-memory LRU cache with configurable max keys
- **L2 (Redis)**: Optional Upstash Redis REST API for scalability
- **Singleflight**: Prevents duplicate work under concurrent load
- **Cache keys**: Based on route + org/user context + request body hash
- **Bypass**: Add `x-cache-allow: 0` header to skip caching
- **Headers**: X-Cache: HIT/MISS/BYPASS
- **TTL**: Per-route configurable time-to-live

### Development Notes
- Service runs on http://localhost:4311
- All responses are deterministic and pre-computed from fixtures/
- Conventional commits enforced via commitlint + husky
- OpenAPI schema validation available in development
- Docker support with healthcheck and multi-stage testing
- Use `.env.example` as reference for environment variables

### Privacy & Security
- Structured logging with parse_text redaction
- No sensitive data logging
- Request/response bodies never logged
- Multi-tier rate limiting with proper HTTP headers
- Optional request context tracking (org/user IDs)