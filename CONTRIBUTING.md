# Contributing to PLoT Engine

Thank you for contributing to PLoT Engine. This guide helps you get started.

## Quick Start

```bash
nvm use                          # Node 20 LTS
npm ci --no-fund --no-audit      # Install dependencies
npm run build && npm test        # Verify setup
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feat/your-feature    # Features
git checkout -b fix/issue-description # Bug fixes
```

### 2. Make Changes

- Follow existing code patterns and TypeScript conventions
- Add tests for new functionality
- Update documentation if needed

### 3. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new inference mode
fix: correct quantile calculation
docs: update API reference
refactor: simplify constraint validation
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

### 4. Create Pull Request

- Target the `staging` branch for features
- Include a clear description of changes
- Reference any related issues

## Code Style

- Use strict TypeScript (avoid `any` where possible)
- Prefer `const` over `let`
- Use `Map`/`Set` for O(1) lookups instead of `.find()`
- Add JSDoc for public functions
- See [TEST_NAMING.md](docs/TEST_NAMING.md) for test conventions

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] OpenAPI spec updated if API changed
- [ ] Documentation updated if behavior changed

---

## Testing

We use a small test orchestrator that brings up a local test server (with test-only routes) and runs the suite.

- Strict (CI parity)
  1. `npm run build`
  2. `RUN_REPLAY_STRICT=1 npm test`

- Fast/local
  1. `npm run build`
  2. `npm test`

Notes
- TEST_BASE_URL is propagated by the test orchestrator; you usually don’t need to set it.
- Test-only endpoints are gated by TEST_ROUTES=1 (enabled by the test server helper). In production these routes return 404.
- Keep-alive agents and health gates are handled by the test runner; avoid adding extra sleeps in tests.
- Artifacts are written to:
  - `reports/tests.json` (Vitest JSON)
  - `reports/warp/` (local PR verify logs and related artefacts)

See also: [Replay telemetry quick reference](./docs/STATUS.md).

## Replay telemetry

- GET `/health` includes `replay` with fields:
  - `lastStatus`: outcome of the last replayed flow (ok or fail)
  - `refusals`: number of connection refusals observed by the replay harness
  - `retries`: number of retry attempts by the harness
  - `lastTs`: ISO timestamp of the latest update
- Test-only endpoints (enabled in tests via TEST_ROUTES=1; 404 in production):
  - GET `/internal/replay-status` → the replay snapshot
  - POST `/internal/replay-report` → increments counters and records status
- The replay tool (tools/replay-fixtures.*) posts `{retry:true}`, `{refusal:true}`, and a terminal `{status:"ok"|"fail"}`.
