# PLoT Engine

[![Nightly Evidence Pack](https://github.com/Talchain/plot-lite-service/actions/workflows/nightly-evidence-pack.yml/badge.svg)](https://github.com/Talchain/plot-lite-service/actions/workflows/nightly-evidence-pack.yml)

Deterministic causal inference engine for decision analysis. Science-powered, production-ready, no LLM calls.

## Quick Start

```bash
nvm use                          # Node 20 LTS
npm ci --no-fund --no-audit      # Install dependencies
npm run build && npm start       # Start server

# Test it works
curl http://localhost:4311/health
curl http://localhost:4311/v1/limits
```

## Key Features

- **Deterministic inference** - Same input + seed = identical output
- **Causal interventions** - Do-calculus with identifiability checks
- **Scenario comparison** - Compare up to 5 options side-by-side
- **Action optimization** - Select optimal actions under budget constraints
- **Production-ready** - p95 < 600ms, rate limiting, comprehensive health checks

## Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/run` | POST | Run causal inference |
| `/v1/compare` | POST | Compare 2-5 scenarios |
| `/v1/intervene` | POST | Causal interventions |
| `/v1/optimise` | POST | Action selection under budget |
| `/v1/sensitivity` | POST | Sensitivity analysis |
| `/v1/validate` | POST | Validate graph structure |
| `/health` | GET | Health status |
| `/v1/limits` | GET | Configuration limits |

See [API Reference](docs/api-reference.md) for complete documentation.

## Example: Run Inference

```bash
curl -X POST http://localhost:4311/v1/run \
  -H 'Content-Type: application/json' \
  -d '{
    "graph": {
      "nodes": [
        {"id": "Price", "label": "Price", "value": 0.5},
        {"id": "Revenue", "label": "Revenue", "value": 0.6}
      ],
      "edges": [{"from": "Price", "to": "Revenue", "weight": 0.8}]
    },
    "seed": 4242
  }'
```

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](docs/api-reference.md) | Complete endpoint documentation |
| [Development Guide](docs/development.md) | Setup, testing, debugging |
| [UI Integration](docs/ui-integration.md) | Client integration patterns |
| [Architecture](docs/engine.md) | Engine internals |
| [Contracts](docs/contracts.md) | Schema definitions |
| [Deployment](docs/RENDER_SETUP.md) | Render deployment guide |

## Requirements

- **Node.js**: 20 LTS
- **Payload limit**: 96 KB
- **Graph limits**: 50 nodes, 200 edges

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4311 | Server port |
| `AUTH_ENABLED` | 0 | Enable bearer auth |
| `RATE_LIMIT_RPM` | 60 | Requests per minute |

See [Development Guide](docs/development.md#environment-variables) for full list.

## Development

```bash
npm run dev      # Development server with hot reload
npm test         # Run tests
npm run lint     # Lint code
npm run build    # Production build
```

## Docker

```bash
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```

## License

Proprietary - Olumi Inc.
