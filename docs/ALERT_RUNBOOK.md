
## H2: Inflight Accounting (Decrement Once)

**What changed**: Replaced manual `__inflightDecDone` flag with WeakSet-based idempotent decrement to prevent double-decrements and underflows.

**When it trips**: If you see negative inflight counts or underflow warnings in logs.

**What to check**:
1. Check `/v1/health` for `inflight` count
2. Monitor `app.inflight.stats().underflows` (should be 0)
3. Verify inflight returns to 0 after requests complete

**Rollback**: Revert to flag-based approach if WeakSet causes issues.

**Risk**: Very low. WeakSet provides automatic cleanup; no memory leaks.
