import { describe, it, expect } from 'vitest';

// Minimal runtime decoder to guard error.v1 envelope stability
// Acts as a canary in lieu of a generated SDK client.

type ErrorCode = 'BAD_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL';
interface ErrorV1 {
  schema: 'error.v1';
  code: ErrorCode;
  message: string;
  path?: string[];
  details?: Record<string, unknown>;
}

function parseErrorV1(x: unknown): ErrorV1 {
  if (typeof x !== 'object' || x === null) throw new Error('not an object');
  const o = x as any;
  if (o.schema !== 'error.v1') throw new Error('bad schema');
  if (!['BAD_INPUT', 'UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL'].includes(o.code)) throw new Error('bad code');
  if (typeof o.message !== 'string') throw new Error('bad message');
  if (o.path && !Array.isArray(o.path)) throw new Error('bad path');
  return o as ErrorV1;
}

describe('SDK envelope smoke: error.v1', () => {
  it('decodes 400 BAD_INPUT', () => {
    const payload = {
      schema: 'error.v1',
      code: 'BAD_INPUT',
      message: 'Missing required field: graph',
      path: ['/graph'],
    } satisfies ErrorV1;
    const parsed = parseErrorV1(payload);
    expect(parsed.code).toBe('BAD_INPUT');
  });

  it('decodes 401 UNAUTHORIZED', () => {
    const payload = {
      schema: 'error.v1',
      code: 'UNAUTHORIZED',
      message: 'Missing bearer token',
    } satisfies ErrorV1;
    const parsed = parseErrorV1(payload);
    expect(parsed.code).toBe('UNAUTHORIZED');
  });

  it('decodes 403 FORBIDDEN', () => {
    const payload = {
      schema: 'error.v1',
      code: 'FORBIDDEN',
      message: 'Invalid token',
    } satisfies ErrorV1;
    const parsed = parseErrorV1(payload);
    expect(parsed.code).toBe('FORBIDDEN');
  });
});
