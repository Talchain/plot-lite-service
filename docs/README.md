# PLoT Engine Documentation

Welcome to the PLoT Engine documentation. This directory contains all operational guides, metrics documentation, and historical reports.

---

## 📁 Directory Structure

### `/observability/` - Metrics & Monitoring
- **[METRICS_CATALOG.md](./observability/METRICS_CATALOG.md)** - Complete catalog of all Prometheus metrics
- **[PROMETHEUS_QUERIES.md](./observability/PROMETHEUS_QUERIES.md)** - Copy-paste ready PromQL queries
- **[HOWTO_test-metrics-endpoint.md](./observability/HOWTO_test-metrics-endpoint.md)** - Testing guide for metrics

### `/runbooks/` - Operational Guides
*Coming in P1/P2*:
- P1_STREAMING_OPERATIONS.md - Enhanced streaming operations guide
- P2_IDEMPOTENCY_OPERATIONS.md - Idempotency & resume operations
- SECRET_ROTATION.md - HMAC secret rotation procedures
- PROXY_SETTINGS.md - Trust proxy configuration

### `/reports/` - Historical Reports
- **[COMPREHENSIVE_ASSESSMENT.md](./reports/COMPREHENSIVE_ASSESSMENT.md)** - Full system assessment
- **[VALIDATION_METRIC_FIX_SUMMARY.md](./reports/VALIDATION_METRIC_FIX_SUMMARY.md)** - Validation metrics fix details
- **[AUDIT_REPORT.md](./reports/AUDIT_REPORT.md)** - Security and code audit
- **[RELEASE_NOTES_v2.1.md](./reports/RELEASE_NOTES_v2.1.md)** - v2.1 release notes

### `/archive/` - Historical Documents
Archived status reports, delivery summaries, and superseded documentation.
- `/archive/sessions/` - Session summaries and progress reports
- `/archive/releases/` - Release notes and acceptance reports
- `/archive/pr-history/` - PR bodies and merge notes
- `/archive/status-reports/` - Historical status and verification reports

---

## 🎯 Quick Links

### Current Status
- **[STATUS.md](./STATUS.md)** - Current production state with live verification

### For Operators
- [Metrics Catalog](./observability/METRICS_CATALOG.md) - What metrics are available
- [Prometheus Queries](./observability/PROMETHEUS_QUERIES.md) - How to query metrics
- [How to Test Metrics](./observability/HOWTO_test-metrics-endpoint.md) - Testing procedures

### For Developers
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute
- [Deployment Guide](../DEPLOYING.md) - How to deploy
- [Release Guide](../RELEASING.md) - How to release

---

## 📊 Production Verification

Quick commands to verify production health:

```bash
# 1. Health check
curl -s https://plot-lite-service.onrender.com/v1/health | jq '.principal_extraction'

# 2. Metrics endpoint
curl -s https://plot-lite-service.onrender.com/metrics | head -20

# 3. Validation metric
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run"'
```

---

## 🚀 Project Status

### Completed ✅
- Full test suite passing (1121 tests)
- ISL integration with metrics and fallback
- CEE circuit breaker integration
- Boot-time timeout budget validation
- Comprehensive ARCHITECTURE.md
- Strict TypeScript config for incremental adoption

### Documentation Structure
- **Root**: Essential docs only (README, ARCHITECTURE, CHANGELOG, CONTRIBUTING, DEPLOYING, RELEASING, ONBOARDING)
- **docs/**: Operational guides and technical documentation
- **docs/archive/**: Historical reports and session notes

---

## 📝 Documentation Standards

When adding new documentation:

1. **Runbooks**: Operational procedures go in `/runbooks/`
2. **Metrics**: Metric definitions and queries in `/observability/`
3. **Reports**: One-time assessments and summaries in `/reports/`
4. **Archive**: Superseded docs in `/archive/`
5. **Root**: Only essential guides (README, CONTRIBUTING, DEPLOYING, RELEASING)

---

## 🔍 Finding Information

| I want to... | Look here |
|--------------|-----------|
| Check current prod status | [STATUS.md](./STATUS.md) |
| Find a specific metric | [METRICS_CATALOG.md](./observability/METRICS_CATALOG.md) |
| Query metrics | [PROMETHEUS_QUERIES.md](./observability/PROMETHEUS_QUERIES.md) |
| Test metrics locally | [HOWTO_test-metrics-endpoint.md](./observability/HOWTO_test-metrics-endpoint.md) |
| Understand a past change | [/reports/](./reports/) |
| Find old status docs | [/archive/](./archive/) |

---

**Last Updated**: 2025-11-27
**Maintained By**: PLoT Engine Team
