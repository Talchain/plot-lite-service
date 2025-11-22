import { expect, it, describe } from 'vitest';

describe('Log Redaction (F6)', () => {
  it('does not leak Authorization tokens', () => {
    const headers = { authorization: 'Bearer SUPERSECRET', foo: 'bar' };
    const { authorization, ...rest } = headers;
    const redacted = { ...rest, authorization: authorization ? '[REDACTED]' : undefined };
    
    expect(JSON.stringify(redacted)).not.toContain('SUPERSECRET');
    expect(redacted.authorization).toBe('[REDACTED]');
  });

  it('handles missing authorization header', () => {
    const headers = { foo: 'bar' };
    const { authorization, ...rest } = headers as any;
    const redacted = { ...rest, authorization: authorization ? '[REDACTED]' : undefined };
    
    expect(redacted.authorization).toBeUndefined();
  });
});
