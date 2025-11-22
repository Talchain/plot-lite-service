import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEngineAdapter } from '../engineAdapter';

describe('UI engine adapter gating (defaults OFF)', () => {
  const save = { UI_ADAPTER_SPIKE: process.env.UI_ADAPTER_SPIKE, FEATURE_ENGINE_ADAPTER: process.env.FEATURE_ENGINE_ADAPTER };
  afterEach(() => {
    if (save.UI_ADAPTER_SPIKE === undefined) delete process.env.UI_ADAPTER_SPIKE; else process.env.UI_ADAPTER_SPIKE = save.UI_ADAPTER_SPIKE;
    if (save.FEATURE_ENGINE_ADAPTER === undefined) delete process.env.FEATURE_ENGINE_ADAPTER; else process.env.FEATURE_ENGINE_ADAPTER = save.FEATURE_ENGINE_ADAPTER;
  });

  it('does not start when flags are OFF', async () => {
    delete process.env.UI_ADAPTER_SPIKE;
    delete process.env.FEATURE_ENGINE_ADAPTER;
    const openStream = vi.fn(async () => ({ cancel: vi.fn() }));
    const adapter = createEngineAdapter({ baseUrl: 'http://127.0.0.1:4311', openStream } as any);
    await adapter.start();
    expect(openStream).not.toHaveBeenCalled();
  });

  it('starts when FEATURE_ENGINE_ADAPTER=1 even if UI_ADAPTER_SPIKE is not set', async () => {
    delete process.env.UI_ADAPTER_SPIKE;
    process.env.FEATURE_ENGINE_ADAPTER = '1';
    const openStream = vi.fn(async () => ({ cancel: vi.fn() }));
    const adapter = createEngineAdapter({ baseUrl: 'http://127.0.0.1:4311', openStream } as any);
    await adapter.start();
    expect(openStream).toHaveBeenCalledOnce();
  });
});
