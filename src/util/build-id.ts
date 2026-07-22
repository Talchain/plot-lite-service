/**
 * Single source of truth for this service's build identity.
 *
 * Resolved ONCE and cached: prefer the CI/CD-provided BUILD_ID / GITHUB_SHA
 * (sliced to a 7-char short id), else `git rev-parse --short HEAD` in dev, else
 * the 'unknown' sentinel. EVERY surface that reports the build — the `/`,
 * `/health`, `/version` bodies, the `x-olumi-service-build` / `X-Build-Tag`
 * response headers, and the `/v2/run` diagnostic payload — MUST call this, so
 * they can never diverge. (They did: the onSend header once resolved to 'dev'
 * because it lacked the git fallback while `/health` reported the real SHA —
 * Codex deep-review F12; the fix is to derive, not mirror.)
 */
import { spawnSync } from 'node:child_process';

let cachedBuildId: string | null = null;

export function getBuildId(): string {
  if (cachedBuildId !== null) return cachedBuildId;

  // Prefer env vars from CI/CD (set at build/deploy time).
  const envBuildId = process.env.BUILD_ID || process.env.GITHUB_SHA;
  if (envBuildId) {
    cachedBuildId = envBuildId.slice(0, 7);
    return cachedBuildId;
  }

  // Fall back to git (one-time only, typically in dev).
  try {
    const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      cachedBuildId = res.stdout.trim();
      return cachedBuildId;
    }
  } catch { /* ignore */ }

  cachedBuildId = 'unknown';
  return cachedBuildId;
}

/**
 * Test-only: clear the memoized id. The cache is resolved once per process (correct
 * in prod, where the build env never changes), but a test that mutates BUILD_ID /
 * GITHUB_SHA must clear it so the next getBuildId() re-resolves — otherwise a prior
 * test file in the same worker locks the value.
 */
export function resetBuildIdCacheForTests(): void {
  cachedBuildId = null;
}
