
## H4: Sensitive-Content Guard Fails Closed

**What changed**: Wrapped deep scan in try/catch. Scanner errors now deny requests with 400 instead of passing through.

**When it trips**: If you see `scannerError: true` in logs for blocked requests.

**What to check**:
1. Check logs for `sensitive scan failed - blocked` messages
2. Verify scanner error details in structured logs
3. Confirm requests are denied (400 response)
4. Monitor for repeated scanner failures (may indicate bug)

**Rollback**: Revert to unwrapped scanner if false positives occur.

**Risk**: Very low. Fail-closed prevents sensitive data leaks. Normal requests unaffected.
