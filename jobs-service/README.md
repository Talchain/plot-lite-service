# Jobs Service

A production-ready durable background jobs service with progress tracking, retries, per-organisation concurrency limits, dead-letter queues, scheduling, and comprehensive observability.

## Features

- **Durable job execution** with progress tracking and retries
- **Per-organisation concurrency** limits and fairness
- **Idempotency** support with configurable TTL
- **Dead-letter queue** for failed jobs
- **Scheduling** support for delayed and recurring jobs
- **Real-time progress** via Server-Sent Events (SSE)
- **Webhook notifications** with HMAC signature verification
- **Comprehensive metrics** and OpenTelemetry tracing
- **Rate limiting** per organisation
- **TypeScript SDK** with full type safety
- **OpenAPI specification** with Swagger UI

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start in development mode (memory storage)
npm run dev

# Start with Redis storage
REPO_KIND=redis UPSTASH_REDIS_REST_URL=redis://localhost:6379 npm run dev
```

### Production

```bash
# Build
npm run build

# Start
npm start
```

### Docker

```bash
# Build and start with Redis
docker-compose up --build

# Or build standalone
docker build -t jobs-service .
docker run -p 4500:4500 jobs-service
```

## Environment Variables

See `.env.example` for all configuration options.

## API Endpoints

- `GET /health` - Health check
- `POST /jobs` - Enqueue a new job
- `GET /jobs/:id` - Get job status
- `POST /jobs/:id/cancel` - Cancel a job
- `POST /jobs/:id/retry` - Retry a failed job
- `GET /jobs` - List jobs (with filtering)
- `GET /jobs/:id/stream` - SSE progress stream (if enabled)

## Built-in Job Types

- `demo:slow-count` - Counts to 10 with progress updates
- `demo:flaky` - Fails first attempt, succeeds on retry
- `demo:blob` - Returns large payload for testing

## License

ISC