import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signPrincipalFingerprint, verifyPrincipalSignature } from '../src/lib/extractPrincipal.js';

describe('verifyPrincipalSignature ACTIVE→STAGED', () => {
  const oldActive = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE;
  const oldStaged = process.env.PRINCIPAL_HMAC_SECRET_STAGED;

  beforeAll(() => {
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
    process.env.PRINCIPAL_HMAC_SECRET_STAGED = 'b'.repeat(64);
  });

  afterAll(() => {
    if (oldActive) process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = oldActive;
    else delete process.env.PRINCIPAL_HMAC_SECRET_ACTIVE;
    if (oldStaged) process.env.PRINCIPAL_HMAC_SECRET_STAGED = oldStaged;
    else delete process.env.PRINCIPAL_HMAC_SECRET_STAGED;
  });

  it('accepts ACTIVE signatures and STAGED (grace) signatures', () => {
    const fp = 'unit-fingerprint';

    // ACTIVE signature is accepted
    const sigActive = signPrincipalFingerprint(fp);
    expect(verifyPrincipalSignature(fp, sigActive)).toBe(true);

    // Simulate legacy signature produced with STAGED secret
    const tmp = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE!;
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = process.env.PRINCIPAL_HMAC_SECRET_STAGED!;
    const sigStaged = signPrincipalFingerprint(fp);
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = tmp;

    // Should verify via STAGED
    expect(verifyPrincipalSignature(fp, sigStaged)).toBe(true);
  });

  it('rejects signatures from unknown secrets', () => {
    const fp = 'unit-fingerprint';
    
    // Create signature with different secret
    const tmp = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE!;
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'c'.repeat(64);
    const sigUnknown = signPrincipalFingerprint(fp);
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = tmp;

    // Should reject (not ACTIVE or STAGED)
    expect(verifyPrincipalSignature(fp, sigUnknown)).toBe(false);
  });
});
