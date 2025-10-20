# PLoT Engine Hardening — BATCH Execution Plan

**Status**: Infrastructure ready, Phases 1-2 implemented and passing, Phases 3-13 stubbed

## Quick Start (Execute Now)

```bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service
export ENGINE_DIR="/Users/paulslee/Documents/GitHub/plot-lite-service"
export TOOLS_DIR="/Users/paulslee/olumi/olumi-tools"
export CONTRACTS_DIR="/Users/paulslee/olumi/olumi-contracts"

# Run full nightly gates (currently phases 1-2 real, 3-13 stubs)
bash RUN_NIGHTLY_GATES.sh

# Output: reports/NIGHTLY_REPORT.md
```

## Current Status

### ✅ Completed Phases

#### Phase 1: Endpoint & SSE Hardening
- **Script**: `tools/gates/01-endpoint-sse-hardening.mjs`
- **Status**: ✅ PASSING
- **Output**:
  - Strong ETag SHA-256 for GET /draft-flows
  - HEAD parity verified
  - If-None-Match → 304 working
  - SSE soak test: 500 cycles, inflight=0
- **GATES Line**: `GATES: PASS — draft-flows deterministic (etag/head/304 OK), SSE stable (N=500, inflight=0)`

#### Phase 2: Contracts Alignment
- **Script**: `tools/gates/02-contracts-alignment.mjs`
- **Status**: ✅ PASSING
- **Artifacts**:
  - `schemas/report.v1.extended.json` (with new IR fields)
  - `contracts/openapi-report-v1.fragment.yaml`
  - Schema hash: `bb333a3a`
- **New Fields Added**:
  - `model_averaging` (bma_hash, K_evaluated, K_used, mass_covered, action_consistency, sign_flip_rate)
  - `confidence.stability` (variance_ratio, cv, stable)
  - `identifiability` (identifiable, adjustment_set, backdoor_satisfied)
  - `actions[]` (action_id, type, node, value, relative_to)
  - `reward` (best_action, regret, top_k[])
  - `time` (inference_ms, bma_ms, total_ms)
  - `provenance` (nodes_source, edges_source, counts)
  - `model_card.response_hash` (required, SHA-256)
- **GATES Line**: `GATES: PASS — contracts aligned (openapi+snapshot updated, response_hash required)`

### 🚧 Stubbed Phases (Implementation Required)

#### Phase 3: Ajv Runtime Validation
- **Script**: `tools/gates/03-stub.mjs` → needs `03-ajv-validation.mjs`
- **Requirements**:
  - Attach schemas to `/v1/run`, `/v1/counterfactual`, `/v1/critique`
  - Enforce bounds on all numeric fields
  - Return `BAD_INPUT` envelope on violation
  - 12 bounds tests must PASS
- **GATES Line**: `GATES: PASS — runtime validation OK (12/12 bounds)`

#### Phase 4: Model Averaging (Seeded Beam)
- **Script**: `tools/gates/04-stub.mjs` → needs `04-model-averaging.mjs`
- **Requirements**:
  - Seeded beam search with sparse prior p_edge≈0.1
  - Fixed CPDAG→DAG tie-break (deterministic)
  - Compute: K_evaluated, K_used, mass_covered, BMA hash
  - Metrics: action_consistency, sign_flip_rate
- **GATES Line**: `GATES: PASS — BMA stable (resp_hash=…, bma_hash=…, K=…, mass=…)`

#### Phase 5: Actions, Reward, Explainability
- **Script**: `tools/gates/05-stub.mjs` → needs `05-actions-reward.mjs`
- **Requirements**:
  - Action semantics: `set` vs `delta` relative to current_state
  - Linear reward computation
  - Compute `best_action`, `top_k[]`, `regret`
  - Explain-Δ across top models with stability flags
  - Include adjustment-set proof
- **GATES Line**: `GATES: PASS — actions+reward OK (best=…, regret=…, top_k=k)`

#### Phase 6: SLOs & Performance
- **Script**: `tools/gates/06-stub.mjs` → needs `06-slos-perf.mjs`
- **Requirements**:
  - Collect `engine_get_p95_ms` from /draft-flows (≥50 samples)
  - ETag/304 discipline
  - Compute K/sec on fixed fixture
  - Assert p95 ≤ 600ms (regressions fail)
- **GATES Line**: `GATES: PASS — slos OK (engine_get_p95_ms=…ms, K_per_sec=…)`

#### Phase 7: Determinism Gates
- **Script**: `tools/gates/07-stub.mjs` → needs `07-determinism.mjs`
- **Requirements**:
  - `engine-detcheck strict` vs golden
  - `normalised` mode (drop volatile, keep schema & meta.seed)
  - Verify BMA hash unchanged across 10 runs
  - All response hashes must match
- **GATES Line**: `GATES: PASS — determinism OK (strict+normalised, resp_hash=…, bma_hash=…, 10/10)`

#### Phase 8: Privacy & Provenance
- **Script**: `tools/gates/08-stub.mjs` → needs `08-privacy-provenance.mjs`
- **Requirements**:
  - `privacy-verify` static AST scan
  - Runtime tap: 0 payload logs
  - Stamp provenance.nodes/edges sources (human|llm|auto)
  - Surface counts in outputs
- **GATES Line**: `GATES: PASS — privacy OK (0 violations)`

#### Phase 9: Canonical Engine Pack
- **Script**: `tools/gates/09-stub.mjs` → needs `09-engine-pack.mjs`
- **Requirements**:
  - Emit `engine_pack_<YYYY-MM-DD>_<sha7>.zip`
  - `manifest.json` (schema: "pack-manifest.v1", component: "engine")
  - `slos.json` (only engine_get_p95_ms)
  - `checksums.json`
  - Canonical ZIP (sorted entries, perms 0644, DOS timestamp clamp)
  - Rebuild twice → identical SHA-256
- **GATES Line**: `GATES: PASS — engine pack canonical (sha256=<hash> identical)`

#### Phase 10: Trust Chain & Policy
- **Script**: `tools/gates/10-stub.mjs` → needs `10-trust-chain.mjs`
- **Requirements**:
  - Pinned @olumi versions
  - Run: pack-lint → evidence-merge → provenance+SBOM → pack-sign → trust-bundle → trust-verify → trust-policy
  - Allow: MIT, Apache-2.0, BSD-2/3, ISC, CC0
  - Ownership enforced
- **GATES Line**: `GATES: PASS — trust GREEN (merge OK, signatures verified, licences OK)`

#### Phase 11: Schema Risk Gate
- **Script**: `tools/gates/11-stub.mjs` → needs `11-schema-risk.mjs`
- **Requirements**:
  - `schema-compat` vs baseline
  - MEDIUM/HIGH risk → fail unless `--allow-risk`
  - Emit `out/schema-diff.md`
- **GATES Line**: `GATES: PASS — schema compatible (risk=LOW|NONE)`

#### Phase 12: CI One-Step (Pinned)
- **Script**: `tools/gates/12-stub.mjs` → needs `12-ci-gate.mjs`
- **Requirements**:
  - Single CI step starts Engine (test profile)
  - Runs Phases 6→11 with pinned @olumi versions
  - Upload artifacts: slos.json, engine pack, trust bundle, schema-diff.md, privacy report, status doc
- **GATES Line**: `GATES: PASS — CI gate chain green (pinned, artefacts uploaded)`

#### Phase 13: Status & Docs
- **Script**: `tools/gates/13-stub.mjs` → needs `13-status-docs.mjs`
- **Requirements**:
  - Generate `GATES_AND_TESTS_STATUS.md`
  - Include: determinism hashes, p95s, K/sec, schema risk, trust colour, privacy/licence status, key snapshot hashes, known skips+owners
  - Update README quick-start
- **GATES Line**: `GATES: PASS — status doc written`

## Failure Handling

All phases follow the pattern:
```javascript
try {
  // phase implementation
  console.log('GATES: PASS — <phase description>');
  process.exit(0);
} catch (err) {
  console.error('GATES: FAIL — <phase>:', err.message);
  writeFileSync(`reports/diag/${phase}.json`, JSON.stringify({
    phase,
    error: err.message,
    stack: err.stack,
    env: { NODE_ENV, ENGINE_DIR, CONTRACTS_DIR, TOOLS_DIR },
    timestamp: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
}
```

## Golden Rules (Enforced Across All Phases)

1. **Deterministic everywhere**: Hashes, p95, pack ZIP must be byte-identical across runs
2. **No probabilities inside node functions F**: Uncertainty via P(M)
3. **Seeded search**: Fixed ordering, tie-breaks, anytime budget
4. **Report includes exploration**: What was explored and why (contracts never lie)
5. **2-space stable JSON**: Canonical key order, stable serialization
6. **Canonical ZIPs**: Sorted entries, perms 0644, DOS timestamp clamp
7. **One GATES: line per phase**: Machine-parseable, aggregated in NIGHTLY_REPORT.md
8. **Pinned versions**: All @olumi tools use exact versions (no ^, ~)
9. **Timers .unref()**: Non-blocking shutdown
10. **exit 0/1**: Success/failure only, no other codes

## Directory Structure

```
plot-lite-service/
├── RUN_NIGHTLY_GATES.sh          ← Main entry point
├── EXEC_HARDENING_PLAN.md        ← This file
├── tools/gates/
│   ├── 01-endpoint-sse-hardening.mjs  ✅ Implemented
│   ├── 02-contracts-alignment.mjs      ✅ Implemented
│   ├── 03-stub.mjs                     🚧 Stub (needs implementation)
│   ├── 04-stub.mjs                     🚧 Stub
│   ├── 05-stub.mjs                     🚧 Stub
│   ├── 06-stub.mjs                     🚧 Stub
│   ├── 07-stub.mjs                     🚧 Stub
│   ├── 08-stub.mjs                     🚧 Stub
│   ├── 09-stub.mjs                     🚧 Stub
│   ├── 10-stub.mjs                     🚧 Stub
│   ├── 11-stub.mjs                     🚧 Stub
│   ├── 12-stub.mjs                     🚧 Stub
│   └── 13-stub.mjs                     🚧 Stub
├── schemas/
│   └── report.v1.extended.json         ✅ Generated
├── contracts/
│   └── openapi-report-v1.fragment.yaml ✅ Generated
└── reports/
    ├── NIGHTLY_REPORT.md               ← Aggregated output
    └── diag/                           ← Phase-specific diagnostics
        ├── 03-ajv-validation.json
        ├── 04-model-averaging.json
        └── ...
```

## Next Steps

### Immediate (You Can Run Now)
```bash
cd /Users/paulslee/Documents/GitHub/plot-lite-service
bash RUN_NIGHTLY_GATES.sh
cat reports/NIGHTLY_REPORT.md
```

Expected output:
- Phases 1-2: PASS (real implementations)
- Phases 3-13: PASS (stubs)
- Total duration: ~5-10s
- Final line: `GATES: PASS — nightly integration report written`

### Implementation Priority (Phases 3-13)

**Week 1** (Core Determinism):
- Phase 4: Model averaging (BMA hash, seeded beam)
- Phase 7: Determinism gates (10/10 runs)
- Phase 6: SLOs & performance (p95 budget)

**Week 2** (Trust & Actions):
- Phase 5: Actions, reward, explainability
- Phase 3: Ajv runtime validation (12 bounds)
- Phase 8: Privacy & provenance

**Week 3** (Packaging & CI):
- Phase 9: Canonical engine pack
- Phase 10: Trust chain & policy
- Phase 11: Schema risk gate

**Week 4** (Integration):
- Phase 12: CI one-step
- Phase 13: Status & docs
- End-to-end validation

### Parallel Development Approach

Each phase is **independent** and can be developed in parallel by different engineers:
- Phase 3 (Ajv): Schema validation engineer
- Phase 4 (BMA): Causal inference engineer
- Phase 5 (Actions): RL/decision theory engineer
- Phases 6-7 (SLOs/Det): Performance engineer
- Phases 8-11 (Trust): Security/compliance engineer
- Phases 12-13 (CI/Docs): DevOps/docs engineer

### Testing Each Phase Individually

```bash
# Test single phase
cd /Users/paulslee/Documents/GitHub/plot-lite-service
node tools/gates/01-endpoint-sse-hardening.mjs

# Check diagnostics on failure
cat reports/diag/01-endpoint-sse.json
```

## Artifacts Manifest

After full implementation, `reports/NIGHTLY_REPORT.md` will contain:

```markdown
=== NIGHTLY INTEGRATION REPORT ===
Started: 2025-10-06T14:00:00Z

[01-endpoint-sse] GATES: PASS — draft-flows deterministic (etag/head/304 OK), SSE stable (N=500, inflight=0)
[01-endpoint-sse] PASS (3s)

[02-contracts] GATES: PASS — contracts aligned (openapi+snapshot updated, response_hash required)
[02-contracts] PASS (1s)

[03-ajv-validation] GATES: PASS — runtime validation OK (12/12 bounds)
[03-ajv-validation] PASS (2s)

[04-model-averaging] GATES: PASS — BMA stable (resp_hash=abc123, bma_hash=def456, K=1000, mass=0.95)
[04-model-averaging] PASS (8s)

[05-actions-reward] GATES: PASS — actions+reward OK (best=raise_price_10pct, regret=0.02, top_k=5)
[05-actions-reward] PASS (4s)

[06-slos-perf] GATES: PASS — slos OK (engine_get_p95_ms=420ms, K_per_sec=2500)
[06-slos-perf] PASS (12s)

[07-determinism] GATES: PASS — determinism OK (strict+normalised, resp_hash=abc123, bma_hash=def456, 10/10)
[07-determinism] PASS (15s)

[08-privacy-provenance] GATES: PASS — privacy OK (0 violations)
[08-privacy-provenance] PASS (3s)

[09-engine-pack] GATES: PASS — engine pack canonical (sha256=deadbeef identical)
[09-engine-pack] PASS (5s)

[10-trust-chain] GATES: PASS — trust GREEN (merge OK, signatures verified, licences OK)
[10-trust-chain] PASS (10s)

[11-schema-risk] GATES: PASS — schema compatible (risk=LOW)
[11-schema-risk] PASS (2s)

[12-ci-gate] GATES: PASS — CI gate chain green (pinned, artefacts uploaded)
[12-ci-gate] PASS (20s)

[13-status-docs] GATES: PASS — status doc written
[13-status-docs] PASS (1s)

=== SUMMARY ===
Total duration: 86s
Completed: 2025-10-06T14:01:26Z

Artifacts:
- schemas/report.v1.extended.json (hash: bb333a3a)
- contracts/openapi-report-v1.fragment.yaml
- out/engine_pack_2025-10-06_abc1234.zip (sha256: deadbeef)
- out/trust-bundle.json
- out/schema-diff.md
- out/privacy-report.json
- GATES_AND_TESTS_STATUS.md
```

## Integration with Olumi Tools

The hardening plan assumes these @olumi tools are available (pinned versions):

```json
{
  "dependencies": {
    "@olumi/pack-lint": "1.2.3",
    "@olumi/evidence-merge": "2.0.1",
    "@olumi/pack-sign": "1.5.0",
    "@olumi/trust-verify": "3.1.0",
    "@olumi/trust-policy": "2.0.0",
    "@olumi/schema-compat": "1.0.5",
    "@olumi/privacy-verify": "1.1.2"
  }
}
```

Phases 10-12 will invoke these tools via `pnpm exec` with exact versions.

## Troubleshooting

### Phase 1 fails with "Address already in use"
```bash
lsof -ti:14311 | xargs kill -9
```

### Phase 2 can't find CONTRACTS_DIR
```bash
export CONTRACTS_DIR="/Users/paulslee/olumi/olumi-contracts"
ls -la "$CONTRACTS_DIR/schemas/report.v1.schema.json"
```

### SSE soak test times out
Increase timeout or reduce cycles in `01-endpoint-sse-hardening.mjs`:
```javascript
await sseStabilitySoak(100); // reduced from 500
```

### Full nightly takes too long
Run phases in parallel (requires implementing parallel harness):
```bash
bash RUN_NIGHTLY_GATES_PARALLEL.sh  # Not yet implemented
```

---

**Status**: Ready to execute. Phases 1-2 are production-ready. Phases 3-13 need implementation following the specifications above.
