# Circuit Breaker: Simulation → Real Deployment

**Minimal delta guide for converting simulated rollout to live execution**

---

## What Changed

### 1. Templates Created (4 files)

**Location**: `templates/rollout/*.template.md`

- `STAGING_LOADTEST_TRANSCRIPT.template.md`
- `CANARY_25_MONITORING.template.md`
- `PROGRESSIVE_ROLLOUT.template.md`
- `CB_ROLLOUT_COMPLETE.template.md`

**Placeholders**:
```
{{DATE}}              - Rollout date (YYYY-MM-DD)
{{OWNER}}             - Engineer name
{{P95_BUDGET_MS}}     - p95 latency budget (150)
{{THRESHOLD}}         - Circuit breaker threshold (50)
{{WINDOW_MS}}         - Time window (10000)
{{STAGING_BASE_URL}}  - Staging URL
{{CANARY_URL}}        - Canary URL
{{PROD_URL}}          - Production URL
{{*_RESULT}}          - Test results (fill during run)
{{*_PASS_FAIL}}       - PASS/FAIL status
{{*_TIMESTAMP}}       - Monitoring timestamps
```

---

### 2. Simulated Docs Stamped

**Files**: `docs/STAGING_LOADTEST_TRANSCRIPT.md`, `docs/CANARY_25_MONITORING.md`, `docs/PROGRESSIVE_ROLLOUT.md`, `docs/CB_ROLLOUT_COMPLETE.md`

**Banner Added**:
```markdown
> ⚠️ This document is a **SIMULATION** used for training/process validation.  
> For a real rollout, use the templates in `templates/rollout/` and fill with live data.
```

---

### 3. Live Rollout Guide

**File**: `docs/CB_LIVE_ROLLOUT_GUIDE.md` (450 LOC)

**Contents**:
- Step-by-step commands for real execution
- Preflight → Staging → Canary → 50% → 100%
- Unhappy path procedures (rollback, triage)
- One-page checklist for operators
- PromQL queries for monitoring

---

### 4. Command Reference Card

**File**: `docs/CB_COMMAND_REFERENCE.md` (250 LOC)

**Contents**:
- Quick reference (copy-paste commands)
- Environment setup
- All stages (preflight, staging, canary, 50%, 100%)
- Rollback procedures
- PromQL queries

---

### 5. Preflight Automation

**File**: `scripts/cb_preflight.sh` (150 LOC, executable)

**What It Does**:
1. Generates strong secret (64-hex)
2. Configures trust proxy
3. Runs all tests
4. Validates alert rules
5. Validates secret strength guard
6. Imports Grafana dashboard
7. Applies Prometheus alerts
8. Color-coded output with clear pass/fail

**Usage**:
```bash
make cb:preflight

# Or with custom config:
GRAFANA_API="http://grafana:3000" \
GRAFANA_TOKEN="<token>" \
PROM_APPLY_CMD="kubectl apply -f" \
./scripts/cb_preflight.sh
```

---

### 6. Makefile Target

**Added**: `cb:preflight` target

```makefile
cb:preflight:
	@echo "Running circuit breaker preflight checks..."
	@./scripts/cb_preflight.sh
```

---

### 7. Live Docs Directory

**Location**: `docs/live/`

**Files**:
- `.gitignore` - Ignores `*.md` by default (prevents accidental commit of drafts)
- `README.md` - Instructions for generating live docs

**Purpose**: Store live rollout docs generated from templates

---

## How to Use (3 Steps)

### Step 1: Run Preflight

```bash
# Set environment
export GRAFANA_API="http://grafana:3000"
export GRAFANA_TOKEN="<your-token>"
export PROM_APPLY_CMD="kubectl apply -f"

# Run preflight
make cb:preflight

# Expected: All checks pass ✅
```

---

### Step 2: Generate Live Docs

```bash
# Set your details
DATE=$(date +%Y-%m-%d)
OWNER="<your-name>"
STAGING_BASE_URL="https://staging.example.com"
CANARY_URL="https://canary.example.com"
PROD_URL="https://prod.example.com"
P95_BUDGET_MS=150
THRESHOLD=50
WINDOW_MS=10000

# Generate from templates
for f in STAGING_LOADTEST_TRANSCRIPT CANARY_25_MONITORING PROGRESSIVE_ROLLOUT CB_ROLLOUT_COMPLETE; do
  sed -e "s/{{DATE}}/$DATE/g" \
      -e "s/{{OWNER}}/$OWNER/g" \
      -e "s/{{P95_BUDGET_MS}}/$P95_BUDGET_MS/g" \
      -e "s/{{THRESHOLD}}/$THRESHOLD/g" \
      -e "s/{{WINDOW_MS}}/$WINDOW_MS/g" \
      -e "s/{{STAGING_BASE_URL}}/$STAGING_BASE_URL/g" \
      -e "s/{{CANARY_URL}}/$CANARY_URL/g" \
      -e "s/{{PROD_URL}}/$PROD_URL/g" \
    templates/rollout/${f}.template.md > docs/live/${f}.md
done

echo "✅ Live docs created in docs/live/"
```

---

### Step 3: Execute Rollout

```bash
# Follow the guide
open docs/CB_LIVE_ROLLOUT_GUIDE.md

# Or use command reference
open docs/CB_COMMAND_REFERENCE.md

# Quick checklist:
# 1. Staging validation
make cb:enable
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=150
# → Paste transcript into docs/live/STAGING_LOADTEST_TRANSCRIPT.md

# 2. Canary 25% (24h)
kubectl set env deployment/plot-engine -l app=plot-engine,tier=canary RL_CB_ENABLE=1
# → Monitor every 15 min, record in docs/live/CANARY_25_MONITORING.md

# 3. 50% (8h)
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod,shard=even RL_CB_ENABLE=1
# → Monitor every hour, record in docs/live/PROGRESSIVE_ROLLOUT.md

# 4. 100% (48h)
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod RL_CB_ENABLE=1
# → Monitor every 6h, record in docs/live/PROGRESSIVE_ROLLOUT.md

# 5. Commit live docs
git add -f docs/live/*.md
git commit -m "ops(cb): live rollout complete - $(date +%Y-%m-%d)"
```

---

## Key Differences: Simulation vs Real

| Aspect | Simulation | Real |
|--------|-----------|------|
| **Docs** | Hardcoded values | Generated from templates |
| **Metrics** | Fabricated snapshots | Live PromQL queries |
| **Health** | Simulated JSON | Actual curl outputs |
| **Timestamps** | Fixed dates | Real timestamps |
| **Pass/Fail** | Pre-filled | Fill during execution |
| **Alerts** | None triggered | Monitor live alerts |
| **Rollback** | Documented only | Actual commands executed |

---

## Unhappy Path Quick Reference

### Staging Fails (p95 > 150ms)

```bash
# Re-run with +20% threshold
THRESHOLD_PLUS_20=$((THRESHOLD + THRESHOLD * 20 / 100))
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=150 THRESHOLD=$THRESHOLD_PLUS_20

# If still fails: abort, file perf ticket
```

### Canary Trips

```bash
# Check reason
curl -s "$PROM_URL/api/v1/query?query=plot_engine_circuit_open_total" | \
  jq '.data.result[] | select(.metric.reason=="threshold")'

# Rollback
make cb:disable
kubectl set env deployment/plot-engine -l app=plot-engine,tier=canary RL_CB_ENABLE=0
```

### Capacity > 80%

```bash
# Increase capacity
export RL_CB_MAX_PRINCIPALS=2000
# Redeploy

# File ticket: "Add principal-creation rate limiting"
```

### Emergency Rollback

```bash
# <1 minute
make cb:disable
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod RL_CB_ENABLE=0
make cb:version BASE_URL="$PROD_URL"  # Verify: RL_CB_ENABLE="0"
```

---

## Files Summary

### Templates (4 files, 800 LOC)
- `templates/rollout/STAGING_LOADTEST_TRANSCRIPT.template.md`
- `templates/rollout/CANARY_25_MONITORING.template.md`
- `templates/rollout/PROGRESSIVE_ROLLOUT.template.md`
- `templates/rollout/CB_ROLLOUT_COMPLETE.template.md`

### Guides (2 files, 700 LOC)
- `docs/CB_LIVE_ROLLOUT_GUIDE.md` - Step-by-step execution
- `docs/CB_COMMAND_REFERENCE.md` - Quick reference card

### Automation (1 file, 150 LOC)
- `scripts/cb_preflight.sh` - Preflight automation

### Infrastructure (3 files)
- `docs/live/.gitignore` - Ignore drafts
- `docs/live/README.md` - Instructions
- `Makefile` - cb:preflight target

### Updated (4 files)
- `docs/STAGING_LOADTEST_TRANSCRIPT.md` - SIMULATION banner
- `docs/CANARY_25_MONITORING.md` - SIMULATION banner
- `docs/PROGRESSIVE_ROLLOUT.md` - SIMULATION banner
- `docs/CB_ROLLOUT_COMPLETE.md` - SIMULATION banner

**Total**: 14 files, 1,650 LOC

---

## Validation

```bash
# Verify templates exist
ls -lh templates/rollout/*.template.md

# Verify preflight script
./scripts/cb_preflight.sh --help || echo "Run without args"

# Verify Makefile target
make cb:preflight

# Generate test docs
DATE=$(date +%Y-%m-%d) OWNER="test" \
  sed -e "s/{{DATE}}/$DATE/g" -e "s/{{OWNER}}/test/g" \
    templates/rollout/STAGING_LOADTEST_TRANSCRIPT.template.md | head -20
```

---

## Status

**Conversion Complete**: ✅

**Ready for Live Execution**: ✅

**Minimal Delta**: ✅
- Simulated docs → Templates with placeholders
- Manual steps → Automated preflight script
- Ad-hoc commands → Structured guide + reference card
- No changes to core CB code or tests

**Next Steps**:
1. Review `docs/CB_LIVE_ROLLOUT_GUIDE.md`
2. Run `make cb:preflight`
3. Generate live docs from templates
4. Execute staged rollout following the guide

---

**See Also**:
- [CB_LIVE_ROLLOUT_GUIDE.md](./CB_LIVE_ROLLOUT_GUIDE.md) - Full execution guide
- [CB_COMMAND_REFERENCE.md](./CB_COMMAND_REFERENCE.md) - Quick reference
- [CB_OPERATOR_HANDOFF.md](./CB_OPERATOR_HANDOFF.md) - Operator quick start
- [CB_ROLLOUT_CHECKLIST.md](./CB_ROLLOUT_CHECKLIST.md) - Deployment checklist
