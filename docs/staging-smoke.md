# Staging Smoke Test

This smoke test validates that the staging PLoT deployment is healthy and that CEE is reachable. It is intended to run manually or in CI after deployment.

## What it checks

1. PLoT health endpoint responds with HTTP 200.
2. CEE health endpoint responds with HTTP 200.
3. PLoT draft-graph proxy returns a valid graph for a canonical brief:
   - HTTP 200
   - `nodes` array contains at least one element
   - `edges` array contains at least one element
   - `analysis_ready` object exists
   - `options` array exists

Each check prints a PASS/FAIL line with a `request_id` for log correlation.

## How to run manually

```bash
SMOKE_API_KEY="<plot auth token>" npx tsx scripts/staging-smoke.ts
```

## Environment variables

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SMOKE_PLOT_URL` | `https://plot-lite-service-staging.onrender.com` | No | Base URL for the PLoT staging service |
| `SMOKE_CEE_URL` | `https://cee-staging.onrender.com` | No | Base URL for the CEE staging service |
| `SMOKE_API_KEY` | (none) | Yes | PLoT bearer token to call `/v1/cee/draft-graph` when auth is enabled |

## CI integration

The workflow at `.github/workflows/staging-smoke.yml` runs automatically on every push to the `staging` branch and can also be triggered manually via `workflow_dispatch`.

It requires three GitHub Actions secrets (Settings > Secrets and variables > Actions):

| Secret name | Maps to | Description |
| --- | --- | --- |
| `PLOT_STAGING_URL` | `SMOKE_PLOT_URL` | PLoT staging base URL (falls back to default if not set) |
| `CEE_STAGING_URL` | `SMOKE_CEE_URL` | CEE staging base URL (falls back to default if not set) |
| `PLOT_AUTH_TOKEN` | `SMOKE_API_KEY` | Bearer token for authenticated PLoT endpoints |

The workflow waits 90s after push for the Render deploy to complete, then runs the smoke script with a 5-minute job timeout.

## Expected output

```
Staging smoke test: plot=https://plot-lite-service-staging.onrender.com, cee=https://cee-staging.onrender.com
[PASS] PLOT /health returns 200 (request_id=...)
[PASS] CEE /healthz returns 200 (request_id=...)
[PASS] PLOT /v1/cee/draft-graph?schema=v3 returns graph (request_id=...)
```

The script exits with status code `0` on success and `1` if any check fails or the 120s total timeout is exceeded.
