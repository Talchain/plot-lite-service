# Phase 2 Roadmap: Fix Consistent Failures

**Goal**: Drive worst-case from 6 → ≤3 failing files

**Current Status**: PR #46 ready to merge (pending approval)

---

## Consistent Failures (5/5 runs - always fail)

### Priority Order (Fast Wins First)

#### 1. #43 confidence.calibration (FAST WIN)
**Branch**: `fix/confidence-calibration-noop`
**Strategy**: Ship no-op calibrator when module/flag absent
- Provide identity mapping when module not present
- Assert shape, not exact numeric values
- Document flag in README.dev
- **Expected delta**: -1 file (6→5)

#### 2. #42 report.contract
**Branch**: `fix/report-critique-array`
**Strategy**: Coerce critique to array in serializer
- Object with numeric keys → `Object.values(obj)`
- Single object → `[obj]`
- Add contract tests for both formats
- **Expected delta**: -1 file (5→4)

#### 3. #41 selfcheck.parity
**Branch**: `fix/selfcheck-stable-hash`
**Strategy**: Introduce `stableHash(obj)`
- Sorted keys, strip volatile fields (trace_id, timestamps)
- UTF-8 canonicalization, sha256 hex
- Add unit tests for canonicalization
- **Expected delta**: -1 file (4→3)

#### 4. #44 extract-principal.integration
**Branch**: `fix/extract-principal-truth-table`
**Strategy**: Implement explicit truth table
- No secret → disabled
- Secret present but CB active/parsing error → degraded
- Valid secret & ok → enabled
- Unit tests for each case
- **Expected delta**: -1 file (3→2)

#### 5. #45 circuit-breaker.lru
**Branch**: `fix/cb-lru-deterministic`
**Strategy**: Use fake timers, deterministic assertions
- Fake timers for TTL advancement
- Assert relative order/eviction set
- Reset LRU between tests
- **Expected delta**: -1 file (2→1)

---

## PR Checklist (Every PR)

### Evidence Required
```
main worst:    Test Files  9 failed | … (171)
this branch:   Test Files  X failed | … (171)
delta:         X - 9 = …   (must be ≤ 0)
```

### Quality Gates
- [ ] 5 runs on branch (worst-case evidence)
- [ ] Tiny, surgical diffs
- [ ] Tests first (red) → code (green)
- [ ] Rollback command in PR body
- [ ] No CI gate edits
- [ ] Isolated env/state
- [ ] Security review (no secrets, bounded metrics)

---

## Automation (Optional - When Ready)

### Baseline-Delta CI Job

Create `.github/workflows/baseline-delta.yml`:

```yaml
name: Baseline Delta (Advisory)

on:
  pull_request:
    branches: [main]

jobs:
  baseline-delta:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - name: Run main baseline (5x)
        run: |
          for i in {1..5}; do
            npm ci && npm run build
            npx vitest run --reporter=dot | tee .ci-main-run$i.txt
          done
          ./parse_baseline.sh > main-evidence.txt
      
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - name: Run PR baseline (5x)
        run: |
          for i in {1..5}; do
            npm ci && npm run build
            npx vitest run --reporter=dot | tee .ci-pr-run$i.txt
          done
          ./parse_baseline.sh > pr-evidence.txt
      
      - name: Post evidence
        run: |
          cat main-evidence.txt pr-evidence.txt | \
          gh pr comment ${{ github.event.pull_request.number }} --body-file -
```

---

## Success Criteria

- [ ] Worst-case ≤3 failing files across 5 runs
- [ ] Variance ≤1 file
- [ ] All PRs follow 5-run protocol
- [ ] Clean rollback path for each change

---

**Next Action**: Await PR #46 merge, then start with `fix/confidence-calibration-noop`
