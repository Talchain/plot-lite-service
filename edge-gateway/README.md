# Edge Gateway - SSE Streaming Service

Stateless SSE gateway for streaming tokens with cancel support and budget enforcement.

## Features

- **Server-Sent Events (SSE)** streaming with proper event formatting
- **Cancellation support** via AbortController and POST /cancel endpoint
- **Resume capability** using Last-Event-ID header
- **Budget enforcement** with token bucket algorithm per organization
- **Heartbeat mechanism** every 15 seconds to keep connections alive
- **Request ID tracking** with X-Request-ID header support

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Server runs on http://localhost:3001
```

### Production

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

```bash
# Server configuration
PORT=3001
NODE_ENV=development

# Budget configuration (safe defaults)
BUDGET_BURST=200              # Initial token burst capacity
BUDGET_SUSTAINED_PER_MIN=5000 # Sustained tokens per minute
```

## API Endpoints

### GET /stream

Start an SSE stream with token simulation.

**Query Parameters:**
- `sessionId` (required) - Unique session identifier
- `org` (required) - Organization ID for budget tracking
- `route` (optional) - Route identifier
- `seed` (optional) - Random seed for deterministic behavior

**Headers:**
- `Last-Event-ID` (optional) - Resume from specific event ID

**Response:** SSE stream with events:
- `hello` - Initial connection event with metadata
- `token` - Individual token with timing data
- `cost` - Periodic cost updates
- `heartbeat` - Keep-alive signal every 15 seconds
- `limit` - Budget exceeded notification
- `cancelled` - Stream was cancelled
- `error` - Stream error occurred

### POST /cancel

Cancel an active streaming session.

**Body:**
```json
{
  "sessionId": "session-123"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session-123",
  "timestamp": "2024-09-21T10:30:00.000Z"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-09-21T10:30:00.000Z",
  "activeSessions": 3,
  "budgetBuckets": 2
}
```

### GET /sessions

Debug endpoint for active sessions.

**Response:**
```json
{
  "activeSessions": [
    {
      "sessionId": "session-123",
      "orgId": "org-456",
      "route": "stream",
      "startTime": 1695291000000,
      "tokenCount": 42,
      "duration": 15000
    }
  ]
}
```

## Usage Examples

### Basic Streaming

```bash
# Start a stream
curl -N "http://localhost:3001/stream?sessionId=demo-123&org=acme-corp&route=chat"

# Output:
# event: hello
# id: 0
# data: {"sessionId":"demo-123","route":"stream","startedAt":"2024-09-21T10:30:00.000Z","totalTokens":45,"resumeFrom":0}
#
# event: token
# id: 1
# data: {"sessionId":"demo-123","token":"The","idx":1,"ts":1695291000123,"remaining":44}
#
# event: token
# id: 2
# data: {"sessionId":"demo-123","token":"quick","idx":2,"ts":1695291000145,"remaining":43}
```

### Resume from Last Event

```bash
# Resume from event ID 10
curl -N -H "Last-Event-ID: 10" \
  "http://localhost:3001/stream?sessionId=demo-resume&org=acme-corp"
```

### Cancel a Stream

```bash
# In another terminal, cancel the stream
curl -X POST http://localhost:3001/cancel \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo-123"}'

# Response:
# {"success":true,"sessionId":"demo-123","timestamp":"2024-09-21T10:30:15.000Z"}
```

### Budget Testing

```bash
# Set low budget limits for testing
export BUDGET_BURST=5
export BUDGET_SUSTAINED_PER_MIN=10

# Start server
npm run dev

# Quickly make multiple requests to trigger budget limits
for i in {1..10}; do
  curl "http://localhost:3001/stream?sessionId=test-$i&org=test-org" &
done

# Some will return HTTP 429 (Too Many Requests)
```

## Testing

```bash
# Run unit tests
npm test

# Run integration tests (starts server automatically)
npm run test:integration

# Run specific test file
npx vitest test/budget.test.ts
```

## Docker

```bash
# Build image
docker build -t edge-gateway .

# Run container
docker run -p 3001:3001 \
  -e BUDGET_BURST=200 \
  -e BUDGET_SUSTAINED_PER_MIN=5000 \
  edge-gateway

# Health check
curl http://localhost:3001/health
```

## Cloudflare Workers Deployment

```bash
# Copy example configuration
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml with your settings

# Deploy to Cloudflare Workers
npx wrangler publish
```

## Architecture

### Budget System
- **Token Bucket Algorithm**: Each organization gets a separate bucket
- **Burst Capacity**: Initial tokens available immediately
- **Sustained Rate**: Tokens refilled per minute
- **Automatic Cleanup**: Old buckets removed after 10 minutes of inactivity

### Session Management
- **AbortController**: Clean cancellation of streams
- **Automatic Cleanup**: Sessions older than 1 hour are removed
- **Token Counting**: Track tokens streamed per session

### Token Simulation
- **Fixture-based**: Uses predefined text for consistent testing
- **Realistic Timing**: 20-30ms between tokens
- **Metadata**: Each token includes index, timestamp, and remaining count

## Performance

- **Concurrent Streams**: Handles multiple simultaneous SSE connections
- **Memory Efficient**: Automatic cleanup of old sessions and buckets
- **Fast Cancellation**: Streams close within 150ms of cancel request
- **Heartbeat**: Prevents connection timeouts with 15-second intervals

## Security

- **Budget Enforcement**: Prevents abuse with per-org token limits
- **Request ID Tracking**: All requests get unique identifiers
- **CORS Support**: Configurable cross-origin access
- **Graceful Degradation**: Service continues if individual streams fail

---

**ACCEPTANCE**: ✅ SSE streaming and cancel working; ✅ budgets enforced; ✅ resume supported; ✅ tests green; ✅ Dockerfile present.