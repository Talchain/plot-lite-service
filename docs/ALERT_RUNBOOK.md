# PLoT-Lite Service Alert Runbook

## H1: Rate Limit Memory Bounded (LRU + TTL)

**What changed**: Replaced unbounded Maps with BoundedLRU (max 10k entries, 10min TTL) to prevent memory growth under burst traffic.

**When it trips**: If you see sustained high memory (RSS > 500MB) or rate limit errors during burst.

**What to check**:
1. Check `/v1/health` for `last5m_429` count
2. Monitor RSS via `process.memoryUsage().rss`
3. Verify LRU size stays ≤ 10k (internal metric)

**Rollback**: Revert to previous Map-based implementation if LRU causes unexpected evictions.

**Risk**: Low. LRU automatically evicts oldest entries; no manual intervention needed.
