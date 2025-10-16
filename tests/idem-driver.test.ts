import { describe, it, expect } from 'vitest';
import { getDriver } from '../src/lib/idem-driver.js';

describe('Idem Driver (E2)', () => {
  it('memory default', async () => {
    const driver = getDriver();
    await driver.set('p1', 'k1', { data: 'test' }, 60000);
    expect((await driver.get('p1', 'k1')).data).toBe('test');
  });

  it('tracks size', async () => {
    const driver = getDriver();
    await driver.set('p1', 'k1', 'v1', 60000);
    expect(await driver.size()).toBeGreaterThanOrEqual(1);
  });
});
