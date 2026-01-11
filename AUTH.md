# Authentication & Security Model

This document describes the authentication, authorization, and security mechanisms used by the PLoT Engine API.

## Overview

The PLoT Engine uses a layered security model:

1. **Bearer Token Authentication** - API access control
2. **Principal Extraction** - Rate limiting and circuit breaker identity
3. **HMAC Signing** - Anti-spoofing for rate limiting
4. **Secret Rotation** - Zero-downtime credential updates

---

## 1. Bearer Token Authentication

### Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_ENABLED` | No | Set to `1` to enable authentication (default: disabled) |
| `AUTH_TOKEN` | When `AUTH_ENABLED=1` | The bearer token clients must provide |

### How It Works

When `AUTH_ENABLED=1`, all `/v1/*` endpoints require a valid `Authorization: Bearer <token>` header.

```http
POST /v1/run HTTP/1.1
Authorization: Bearer your-secret-token
Content-Type: application/json
```

### Response Codes

| Code | Condition |
|------|-----------|
| `401 Unauthorized` | Missing `Authorization` header or not `Bearer` format |
| `403 Forbidden` | Invalid token (timing-safe comparison) |

### Demo Mode Bypass

GET `/v1/stream` requests with demo mode enabled (`X-Demo-Mode: 1`) bypass authentication for public demos.

---

## 2. Principal Extraction

Principal extraction derives a unique, opaque identifier from each request for rate limiting and circuit breaker purposes. **No PII is stored or logged.**

### Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PRINCIPAL_HMAC_SECRET` | For HMAC signing | 64+ hex chars (32 bytes) |
| `PRINCIPAL_HMAC_SECRET_ACTIVE` | For rotation | Primary secret during rotation |
| `PRINCIPAL_HMAC_SECRET_STAGED` | For rotation | Secondary secret during rotation |
| `TRUST_PROXY` | Behind load balancer | Set to `1` to trust X-Forwarded-For |
| `TRUST_PROXY_HOPS` | With `TRUST_PROXY` | Number of trusted proxy hops (default: 1) |

### Priority Order

1. **Authenticated Principal** (if `req.user.id` or `req.principal` exists):
   ```
   auth:HMAC(secret, userId) → "auth:abc123..."
   ```

2. **Anonymous Fallback** (for unauthenticated requests):
   ```
   anon:HMAC(secret, canonicalIP|sha256(userAgent)) → "anon:xyz789..."
   ```

### IP Canonicalization

When `TRUST_PROXY=1`, the canonical IP is extracted from `X-Forwarded-For`:
- Takes the Nth hop from the right (where N = `TRUST_PROXY_HOPS`)
- Falls back to socket remote address if header missing

---

## 3. Token-Based Rate Limiting

For API key-based rate limiting (alternative to IP-based).

### Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TOKEN_RL_ENABLE` | No | Set to `1` to enable token-based rate limiting |
| `TOKEN_HMAC_SECRET` | When `TOKEN_RL_ENABLE=1` | 64+ hex chars for HMAC signing |

### How It Works

When enabled, the `Authorization: Bearer <token>` is HMAC'd to create a rate-limit key:

```
token:HMAC(secret, bearerToken) → "token:def456..."
```

This allows different API keys to have independent rate limits without storing the actual tokens.

---

## 4. Secret Rotation

### Zero-Downtime Rotation

The principal extraction supports dual-secret verification for zero-downtime rotation:

1. Set `PRINCIPAL_HMAC_SECRET_STAGED` to the new secret
2. Deploy (both secrets are accepted for verification)
3. After all clients updated, promote staged to active:
   - Set `PRINCIPAL_HMAC_SECRET_ACTIVE` to the new secret
   - Remove `PRINCIPAL_HMAC_SECRET_STAGED`
4. Deploy

### Observability

The health endpoint reports rotation state:

```json
{
  "principal_extraction": {
    "enabled": true,
    "secrets": {
      "active": true,
      "staged": false
    }
  }
}
```

---

## 5. External Service Security

### Production Requirements

In production (`NODE_ENV=production`), external service URLs must use HTTPS:

| Variable | Requirement |
|----------|-------------|
| `CEE_BASE_URL` | Must start with `https://` |
| `ISL_BASE_URL` | Must start with `https://` |

Startup fails if HTTP URLs are configured in production.

---

## 6. Route Protection Summary

| Route Pattern | Auth Required | Rate Limited | Notes |
|--------------|---------------|--------------|-------|
| `/v1/*` | When `AUTH_ENABLED=1` | Yes | Main API endpoints |
| `/health`, `/ready`, `/live` | No | No | Health checks |
| `/metrics` | No | No | Prometheus metrics |

---

## 7. Generating Secrets

Generate cryptographically secure secrets:

```bash
# Generate 32-byte hex secret (64 chars)
openssl rand -hex 32

# Example output:
# a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

Set in your environment:

```bash
export TOKEN_HMAC_SECRET="$(openssl rand -hex 32)"
export PRINCIPAL_HMAC_SECRET="$(openssl rand -hex 32)"
export AUTH_TOKEN="$(openssl rand -hex 32)"
```

---

## 8. Security Headers

The API sets the following security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |

---

## 9. Sensitive Data Handling

### What Is NOT Logged

- Bearer tokens
- HMAC secrets
- Full IP addresses (only canonicalized)
- Request/response bodies containing sensitive data

### What IS Logged

- Opaque principal identifiers (`auth:...`, `anon:...`, `token:...`)
- Request IDs for correlation
- Response status codes
- Latency metrics

---

## 10. Fail-Fast Validation

At startup, the server validates:

1. **HMAC Secrets**: Must be ≥64 hex chars
2. **External URLs**: Must use HTTPS in production

If validation fails, the server exits with a clear error message:

```
[FATAL] HMAC Secret Validation Failed:
  ❌ TOKEN_HMAC_SECRET: too short (32 chars, need ≥64)

Generate strong secrets: openssl rand -hex 32
```
