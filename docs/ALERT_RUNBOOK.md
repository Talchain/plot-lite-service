
## H3: Safe SIGHUP Config Reload

**What changed**: Added validation + rollback to SIGHUP handler. Bad configs are rejected; last good config is kept.

**When it trips**: If you see `reload_rejected` warnings after SIGHUP.

**What to check**:
1. Check logs for `reload_rejected` event with error details
2. Verify config file syntax (valid JSON)
3. Check for unknown keys or invalid values
4. Confirm `last_config_reload_iso` timestamp (should NOT update on failure)

**Rollback**: Fix config file and send SIGHUP again.

**Risk**: Very low. Process never crashes on bad config; keeps running with last good values.
