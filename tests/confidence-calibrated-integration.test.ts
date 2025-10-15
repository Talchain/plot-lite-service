import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Confidence Calibration Integration (flag-gated)', () => {
  let origFlag: string | undefined;

  beforeEach(() => {
    origFlag = process.env.CONFIDENCE_CALIBRATED;
  });

  afterEach(() => {
    if (origFlag !== undefined) {
      process.env.CONFIDENCE_CALIBRATED = origFlag;
    } else {
      delete process.env.CONFIDENCE_CALIBRATED;
    }
  });

  it('flag appears in /version when set', async () => {
    process.env.CONFIDENCE_CALIBRATED = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.feature_flags).toHaveProperty('CONFIDENCE_CALIBRATED');
    expect(body.feature_flags.CONFIDENCE_CALIBRATED).toBe('1');
    
    await app.close();
  });

  it('flag defaults to 0 when unset', async () => {
    delete process.env.CONFIDENCE_CALIBRATED;
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.feature_flags.CONFIDENCE_CALIBRATED).toBe('0');
    
    await app.close();
  });
});
