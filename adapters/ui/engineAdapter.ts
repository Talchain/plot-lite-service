// Flag-gated UI adapter spike (no runtime integration by default)
// Enable only when UI_ADAPTER_SPIKE=1 in the environment of the consumer.

export type SseEvent = { event: string; id?: string; data?: any };

export type OpenStreamLike = (opts: {
  url: string;
  id?: string;
  lastEventId?: string | number;
  onEvent: (ev: SseEvent) => void;
  onError?: (err: any) => void;
}) => Promise<{ cancel: () => void }>;

export type AdapterCallbacks = {
  onTTFB?: (ms: number) => void;
  onToken?: (token: { text: string; index: number }) => void;
  onCost?: (cost: { tokens: number; currency: string; amount: number }) => void;
  onLimited?: (info: any) => void;
  onDone?: (info: any) => void;
  onError?: (err: any) => void;
};

export type AdapterOptions = {
  baseUrl: string; // e.g. http://127.0.0.1:4311
  id?: string;
  openStream: OpenStreamLike; // dependency injection for testability
  callbacks?: AdapterCallbacks;
};

export function createEngineAdapter(opts: AdapterOptions) {
  const { baseUrl, id, openStream, callbacks } = opts;
  let controller: { cancel: () => void } | null = null;
  let lastEventId: string | number | undefined;
  let startedAt = 0;
  let sawFirstEvent = false;

  async function start(): Promise<void> {
    // Strictly flag-gated: enable when either FEATURE_ENGINE_ADAPTER=1 or UI_ADAPTER_SPIKE=1
    const enabled = process.env.FEATURE_ENGINE_ADAPTER === '1' || process.env.UI_ADAPTER_SPIKE === '1';
    if (!enabled) { return; }
    startedAt = Date.now();
    sawFirstEvent = false;
    controller = await openStream({
      url: `${baseUrl.replace(/\/$/, '')}/stream`,
      id,
      lastEventId,
      onEvent: (ev) => {
        if (!sawFirstEvent) {
          sawFirstEvent = true;
          const ttfb = Date.now() - startedAt;
          callbacks?.onTTFB?.(ttfb);
        }
        if (ev.id != null) lastEventId = ev.id;
        switch (ev.event) {
          case 'token':
            callbacks?.onToken?.(ev.data);
            break;
          case 'cost':
            callbacks?.onCost?.(ev.data);
            break;
          case 'limited':
            callbacks?.onLimited?.(ev.data);
            break;
          case 'done':
            callbacks?.onDone?.(ev.data);
            break;
          case 'error':
            callbacks?.onError?.(ev.data);
            break;
          default:
            // hello/cancelled ignored for UI
            break;
        }
      },
      onError: (err) => callbacks?.onError?.(err),
    });
  }

  function cancel() {
    try { controller?.cancel(); } catch {}
  }

  async function resume() {
    // resume connects with lastEventId; simply restart
    await start();
  }

  return { start, cancel, resume };
}
