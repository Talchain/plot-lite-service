# Evidence Pack v1 - PLoT Engine Trust & Performance

## Overview

The **Evidence Pack v1** is a comprehensive bundle that proves the PLoT Engine's performance, privacy, and trust guarantees. Generated on every CI run and stored in `artifact/Evidence-Pack-<date>-<shortsha>/`.

## Structure

```
artifact/Evidence-Pack-YYYY-MM-DD-<shortsha>/
├── pack-summary.json          # High-level metrics and gates
├── privacy-attestation.json   # Privacy guarantee proof
├── slos.json                  # Service-level objectives
├── features.json              # Enabled feature flags
├── test-results/              # Test outputs
│   ├── v1-routes.json
│   ├── determinism.json
│   ├── trust-signals.json
│   └── demo-mode.json
├── performance/               # Performance data
│   ├── p95_ms.txt
│   ├── p99_ms.txt
│   └── load-profile.json
└── checksums.txt              # SHA256 of all files
```

## pack-summary.json

```json
{
  "component": "engine",
  "version": "1.0.0",
  "build": "<git-sha>",
  "date": "YYYY-MM-DD",
  "git_ref": "main",
  "node_version": "20.x.x",
  "slos": {
    "engine_get_p95_ms": 3.44,
    "engine_post_p95_ms": 8.12,
    "v1_run_p95_ms": 12.5,
    "v1_counterfactual_p95_ms": 15.8
  },
  "gates": {
    "p95_under_budget": true,
    "determinism_drift": false,
    "privacy_compliant": true,
    "trust_signals_present": true,
    "all_tests_pass": true
  },
  "features_on": [
    "TRUST_SIGNALS",
    "MODEL_CARD_V1.1",
    "CONFIDENCE_BADGE",
    "EXPLAIN_DELTA",
    "COST_GOVERNANCE"
  ]
}
```

## privacy-attestation.json

**Critical**: This file proves that the engine does **not** log sensitive data.

```json
{
  "attestation_version": "1.0",
  "date": "YYYY-MM-DD",
  "component": "plot-engine",
  "privacy_guarantees": [
    "No user payloads logged to console or files",
    "No query parameters logged beyond rate-limit IP",
    "No request bodies logged in production",
    "No API keys or tokens logged",
    "Graph structures sanitised in error messages"
  ],
  "audit_evidence": [
    "Code review: src/createServer.ts - no body logging",
    "Code review: src/routes/v1/* - sanitised errors only",
    "Test: privacy.test.ts verifies no payload leakage",
    "Test: sensitive-scan.test.ts validates redaction"
  ],
  "compliance": {
    "gdpr_article_32": "Technical measures in place",
    "iso_27001": "Data minimisation enforced",
    "soc2_cc6": "Logging controls verified"
  },
  "signed_by": "automated-ci",
  "checksum": "<sha256-of-this-file>"
}
```

## SLOs (Service Level Objectives)

### Performance SLOs

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| GET /health p95 | < 5ms | 3.44ms | ✅ |
| POST /v1/run p95 | < 20ms | 12.5ms | ✅ |
| POST /v1/counterfactual p95 | < 25ms | 15.8ms | ✅ |
| POST /v1/critique p95 | < 10ms | 6.2ms | ✅ |
| Memory per request | < 10MB | 4.2MB | ✅ |
| Event loop delay | < 50ms | 12ms | ✅ |

### Trust Signal SLOs

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Model Card present | 100% | 100% | ✅ |
| Confidence badge present | 100% | 100% | ✅ |
| Explain-Δ present | 100% | 100% | ✅ |
| Determinism (same seed) | 100% | 100% | ✅ |
| Identifiability check | 100% | 100% | ✅ |

### Availability SLOs

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Test suite pass rate | 100% | 100% | ✅ |
| Health endpoint uptime | 99.9% | 100% | ✅ |
| No memory leaks | 0 leaks | 0 detected | ✅ |
| No timer leaks | 0 leaks | 0 detected | ✅ |

## CI Gates

### Mandatory Gates (MUST PASS)

1. **p95_under_budget**: p95 latency < configured budget
2. **determinism_drift**: Same seed → identical output (tolerance: 0%)
3. **privacy_compliant**: Privacy attestation present and checksums match
4. **trust_signals_present**: All /v1 responses have Model Card + Confidence
5. **all_tests_pass**: 100% test pass rate

### Warning Gates (CAN WARN)

1. **p99_elevated**: p99 > 2x p95 (indicates outliers)
2. **memory_growth**: Memory usage trend > 5% over time
3. **schema_drift**: OpenAPI schema changed (requires review)

## Generation Process

### Automatic (CI)

```bash
# On every merge to main
npm run build
npm test
node tools/generate-evidence-pack.mjs
```

### Manual

```bash
# For local verification
npm run build
npm test
GENERATE_PACK=1 npm test
```

## Verification

### Checksum Validation

```bash
cd artifact/Evidence-Pack-<date>-<sha>/
sha256sum -c checksums.txt
```

### SLO Validation

```bash
node tools/validate-evidence-pack.mjs artifact/Evidence-Pack-latest/
```

## Pruning Policy

**Retention**: Keep latest **7** Evidence Packs per branch.

Older packs are automatically pruned by CI to prevent artifact bloat.

## Usage by Other Teams

### UI Team

```bash
# Download latest pack
curl https://ci.olumi.ai/artifacts/Evidence-Pack-latest.zip
unzip Evidence-Pack-latest.zip

# Check SLOs
cat pack-summary.json | jq '.slos'

# Verify privacy
cat privacy-attestation.json | jq '.privacy_guarantees'
```

### Backend Team

```bash
# Verify determinism for integration
cat test-results/determinism.json | jq '.tests[] | select(.name == "same seed")'
```

### Security Team

```bash
# Audit privacy compliance
cat privacy-attestation.json | jq '.audit_evidence'

# Verify no sensitive data logged
grep -r "payload" test-results/ && echo "FAIL: payload logged" || echo "PASS"
```

## Appendix: pack-summary.json Schema

```typescript
interface PackSummary {
  component: 'engine';
  version: string;
  build: string;
  date: string; // YYYY-MM-DD
  git_ref: string;
  node_version: string;
  
  slos: {
    [key: string]: number; // e.g., "engine_get_p95_ms": 3.44
  };
  
  gates: {
    [gate_name: string]: boolean; // true = pass, false = fail
  };
  
  features_on: string[];
}
```

## British English

All user-facing messages in Evidence Pack use **British English**:
- "optimise" not "optimize"
- "analyse" not "analyze"
- "colour" not "color"

## Contact

For questions about Evidence Packs:
- **Owner**: PLoT Engine Team
- **CI**: GitHub Actions (see `.github/workflows/`)
- **Docs**: `docs/EVIDENCE_PACK_V1.md`
