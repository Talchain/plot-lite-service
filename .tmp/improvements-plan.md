# Remaining Improvements to A (95+)

## 1. Outlier Investigation ✅
- Analyzed run 4 (559/588)
- Root cause: Timing/race conditions in server startup
- Pattern: Determinism + feature tests fail together
- Fix: Already has health check, add small delay

## 2. Enhanced Stability Test
- Run 5 more consecutive tests
- Target: All within 2-test variance
- Document results

## 3. P1A/P1B Stability
- Current: 80-90%
- Target: >95%
- Already isolated, may improve with more runs

## Quick Wins:
- Add 100ms delay after health check in spawnServer
- Run 5 more verification tests
- Document final results
