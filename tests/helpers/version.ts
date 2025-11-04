/**
 * Shared version constant for test assertions
 *
 * Tests should assert against this constant rather than hardcoding version strings.
 * This ensures tests don't break when the service version is bumped.
 */

export { SERVICE_VERSION } from '../../src/version.js';
