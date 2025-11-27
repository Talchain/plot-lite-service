# Phase A1: Merge Instructions

## Manual Steps Required (GitHub Web UI)

The following PRs are ready and must be merged in this exact order:

### 1. Merge B1 Timeslices FIRST
- **Branch**: `feat/b1-timeslices`
- **URL**: https://github.com/Talchain/plot-lite-service/pull/new/feat/b1-timeslices
- **Tests**: 6/6 passing ✅
- **Action**: Create PR, review, and merge to main

**Post-Merge Smoke Test**:
```bash
# Deploy to staging
# Run determinism test
curl -X POST https://staging.../v1/run_timeslices \
  -H "Content-Type: application/json" \
  -d '{
    "graph": {"nodes": [{"id":"A","label":"A"}], "edges":[]},
    "timeslices": ["T1","T2"],
    "seed": 4242
  }'
# Verify: same seed → same response_hash
# Verify: X-Request-Id echoed
# Verify: structured log with {evt, id, route, duration_ms}

# Test guard rails
curl -X POST https://staging.../v1/run_timeslices \
  -d '{"graph":{...}, "timeslices": ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12","T13"], "seed":4242}'
# Verify: 400 BAD_INPUT with "Maximum 12 timeslices"
```

### 2. Merge C1 Priors SECOND
- **Branch**: `feat/c1-priors`
- **URL**: https://github.com/Talchain/plot-lite-service/pull/new/feat/c1-priors
- **Tests**: 7/7 passing ✅
- **Action**: Create PR, review, and merge to main

**Post-Merge Smoke Test**:
```bash
# Test priors on /v1/run
curl -X POST https://staging.../v1/run \
  -H "Content-Type: application/json" \
  -d '{
    "graph": {"nodes": [{"id":"A","label":"A"}], "edges":[]},
    "priors": {"A": 0.6},
    "seed": 4242
  }'
# Verify: 200 OK, deterministic
# Verify: X-Request-Id echoed

# Test invalid prior
curl -X POST https://staging.../v1/run \
  -d '{"graph":{...}, "priors": {"A": 1.5}, "seed":4242}'
# Verify: 400 BAD_INPUT with field pointer "priors.A"
```

### 3. Merge C2 Evidence THIRD
- **Branch**: `feat/c2-evidence`
- **URL**: https://github.com/Talchain/plot-lite-service/pull/new/feat/c2-evidence
- **Tests**: 11/11 passing ✅
- **Depends on**: C1 (includes priors validation)
- **Action**: Create PR, review, and merge to main

**Post-Merge Smoke Test**:
```bash
# Test evidence on /v1/run
curl -X POST https://staging.../v1/run \
  -H "Content-Type: application/json" \
  -d '{
    "graph": {"nodes": [{"id":"A","label":"A"}], "edges":[]},
    "evidence": [{"node_id":"A", "source":"test", "note":"secret", "weight":0.8}],
    "seed": 4242
  }'
# Verify: 200 OK
# Verify: meta.evidence_applied present (no note field)
# Verify: X-Request-Id echoed
# Verify: logs show evidence_count, not payload

# Test invalid evidence
curl -X POST https://staging.../v1/run \
  -d '{"graph":{...}, "evidence": [{"node_id":"Z", "source":"test"}], "seed":4242}'
# Verify: 400 BAD_INPUT with field pointer "evidence[0].node_id"
```

## Automated Continuation

Once all three PRs are merged, the autonomous process will continue with Phase A2 (Test Stabilization).

**Status**: ⏸️ WAITING FOR MANUAL MERGE (GitHub permissions required)
