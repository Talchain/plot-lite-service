# PLoT Engine Documentation

Welcome to the PLoT Engine documentation. This directory contains operational guides, technical specifications, and historical records.

---

## 📁 Directory Structure

### Core Documentation (docs/ root)
| File | Purpose |
|------|---------|
| [STATUS.md](./STATUS.md) | Current production state |
| [PLATFORM_OVERVIEW.md](./PLATFORM_OVERVIEW.md) | Enterprise architecture overview |
| [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md) | Operations runbook |
| [RENDER_SETUP.md](./RENDER_SETUP.md) | Render deployment setup |
| [engine.md](./engine.md) | Engine contracts & gating |
| [errors.md](./errors.md) | Error codes reference |

### `/observability/` - Metrics & Monitoring
- [METRICS_CATALOG.md](./observability/METRICS_CATALOG.md) - All Prometheus metrics
- [PROMETHEUS_QUERIES.md](./observability/PROMETHEUS_QUERIES.md) - PromQL templates
- [HOWTO_test-metrics-endpoint.md](./observability/HOWTO_test-metrics-endpoint.md) - Testing guide

### `/plot-lite-engine/` - Technical Documentation
Numbered documentation series (00-80) covering architecture, roadmap, test plans, and performance.

### `/reports/` - Assessments & Release Notes
- [AUDIT_REPORT.md](./reports/AUDIT_REPORT.md) - Security audit
- [COMPREHENSIVE_ASSESSMENT.md](./reports/COMPREHENSIVE_ASSESSMENT.md) - System assessment
- [RELEASE_NOTES_v2.1.md](./reports/RELEASE_NOTES_v2.1.md) - Release notes

### `/collections/` - API Testing
- [plot-lite.postman.json](./collections/plot-lite.postman.json) - Postman collection

### `/schema/` - Contract Definitions
- [report.v1.json](./schema/report.v1.json) - Report schema

### `/archive/` - Historical Documents
- `/archive/root/` - Archived root-level status/progress reports (~142 files)
- `/archive/` - Historical operational docs

---

## 🎯 Quick Links

### For Operators
| Task | Document |
|------|----------|
| Check production status | [STATUS.md](./STATUS.md) |
| Respond to alerts | [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md) |
| Find a metric | [METRICS_CATALOG.md](./observability/METRICS_CATALOG.md) |
| Query Prometheus | [PROMETHEUS_QUERIES.md](./observability/PROMETHEUS_QUERIES.md) |

### For Developers
| Task | Document |
|------|----------|
| Understand architecture | [PLATFORM_OVERVIEW.md](./PLATFORM_OVERVIEW.md) |
| Contribute code | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Deploy changes | [DEPLOYING.md](../DEPLOYING.md) |
| Release version | [RELEASING.md](../RELEASING.md) |

### For DevOps/Platform
| Task | Document |
|------|----------|
| Platform overview | [PLATFORM_OVERVIEW.md](./PLATFORM_OVERVIEW.md) |
| Integration points | See CEE/ISL/UI sections in PLATFORM_OVERVIEW |
| Configuration vars | See Section 8 in PLATFORM_OVERVIEW |

---

## 📊 Production Verification

```bash
# Health check
curl -s https://plot-lite-service.onrender.com/v1/health | jq '.status'

# Metrics endpoint
curl -s https://plot-lite-service.onrender.com/metrics | head -20

# Validation metric
curl -s https://plot-lite-service.onrender.com/metrics | grep 'plot_engine_validation'
```

---

## 📝 Documentation Standards

| Type | Location |
|------|----------|
| Operations/runbooks | `/observability/` or root |
| Technical specs | `/plot-lite-engine/` |
| One-time assessments | `/reports/` |
| API collections | `/collections/` |
| Superseded docs | `/archive/` |

**Rules:**
- Only essential guides in repository root
- Archive status/progress docs after milestone completion
- Keep STATUS.md as single source of truth for prod state

---

**Last Updated**: 2025-11-28
**Maintained By**: PLoT Engine Team
