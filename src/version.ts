/**
 * Centralized service version for all endpoints and metadata.
 *
 * Single source of truth for version reporting to prevent drift across:
 * - Public endpoints (/version, /v1/version, /v1/health)
 * - Model metadata (meta.version in /v1/run, /v1/self-check)
 * - Test fixtures and assertions
 *
 * Note: This is the SERVICE version. The API protocol identifier (warp/0.1.0)
 * is kept separate and appears in the `api` field of some endpoints.
 */

export const SERVICE_VERSION =
  process.env.SERVICE_VERSION ??
  ((): string => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../package.json');
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  })();
