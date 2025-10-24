/**
 * Helper for asserting error.v1 envelope format
 * 
 * Usage:
 *   const body = await res.json();
 *   expectErrorV1(body, 'BAD_INPUT');
 */
export function expectErrorV1(body: any, code: string) {
  expect(body?.schema).toBe('error.v1');
  expect(body?.code).toBe(code);
  expect(typeof body?.message).toBe('string');
}

/**
 * Helper for asserting error.v1 with specific message
 */
export function expectErrorV1WithMessage(body: any, code: string, message: string) {
  expectErrorV1(body, code);
  expect(body?.message).toBe(message);
}

/**
 * Helper for asserting error.v1 with message pattern
 */
export function expectErrorV1WithPattern(body: any, code: string, pattern: RegExp) {
  expectErrorV1(body, code);
  expect(body?.message).toMatch(pattern);
}
