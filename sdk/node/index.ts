// Tiny Node SDK for PLoT-lite mock streaming
// openStream({ url, id, onEvent, onResume, onCancel, onError })
// Node 20: use fetch + Web Streams to parse SSE lines.

export type OpenStreamOpts = {
  url: string; // base stream URL, e.g. http://127.0.0.1:4390/stream
  id?: string;
  headers?: Record<string, string>;
  lastEventId?: string | number;
  onEvent?: (ev: { event: string; id?: string; data?: any }) => void;
  onResume?: (id: string | number) => void;
  onCancel?: () => void;
  onError?: (err: any) => void;
};

export type StreamController = { cancel: () => void };

export async function openStream(opts: OpenStreamOpts): Promise<StreamController> {
  const url = new URL(opts.url);
  if (opts.id) url.searchParams.set('id', String(opts.id));
  const init: RequestInit = { headers: { 'accept': 'text/event-stream', ...(opts.headers || {}) } };
  if (opts.lastEventId != null) (init.headers as any)['Last-Event-ID'] = String(opts.lastEventId);
  const res = await fetch(url, init);
  if (!(res.ok)) throw new Error(`stream_http_${res.status}`);
  const reader = res.body!.getReader();
  let buf = '';
  let cancelled = false;

  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = '', id: string | undefined, dataRaw = '';
        for (const line of block.split('\n')) {
          const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
          if (k === 'event') ev = v;
          else if (k === 'id') id = v;
          else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
        }
        let data: any = dataRaw;
        try { data = JSON.parse(dataRaw); } catch {}
        opts.onEvent?.({ event: ev, id, data });
        if (ev === 'cancelled') opts.onCancel?.();
        if (ev === 'token' && id) opts.onResume?.(id);
      }
    }
  };

  pump().catch(err => opts.onError?.(err));

  return {
    cancel: () => { cancelled = true; try { reader.cancel(); } catch {} }
  };
}
