// Tiny Node SDK for PLoT-lite mock streaming
// openStream({ url, id, onEvent, onResume, onCancel, onError })
// Node 20: use fetch + Web Streams to parse SSE lines.

// Existing stream helpers remain; we add tiny SDK run()/stream() below.

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

// Optional: async iterator over SSE events. Usage:
// for await (const ev of iterateStream({ url, id })) { ... }
// Supports Last-Event-ID for resume and returns a controller with cancel().
export async function iterateStream(opts: {
  url: string;
  id?: string | number;
  lastEventId?: string | number;
  headers?: Record<string, string>;
}): Promise<{
  controller: { cancel: () => void };
  [Symbol.asyncIterator](): AsyncIterator<{ event: string; id?: string; data?: any }>;
}> {
  const url = new URL(opts.url);
  if (opts.id != null) url.searchParams.set('id', String(opts.id));
  const init: RequestInit = { headers: { 'accept': 'text/event-stream', ...(opts.headers || {}) } };
  if (opts.lastEventId != null) (init.headers as any)['Last-Event-ID'] = String(opts.lastEventId);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`stream_http_${res.status}`);
  const reader = res.body!.getReader();
  let buf = '';
  let done = false;
  const td = new TextDecoder();

  const controller = { cancel: () => { try { reader.cancel(); } catch {} done = true; } };

  async function next(): Promise<IteratorResult<{ event: string; id?: string; data?: any }>> {
    while (true) {
      const sepIdx = buf.indexOf('\n\n');
      if (sepIdx >= 0) {
        const block = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + 2);
        let ev = '', id: string | undefined, dataRaw = '';
        for (const line of block.split('\n')) {
          const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
          if (k === 'event') ev = v;
          else if (k === 'id') id = v;
          else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
        }
        let data: any = dataRaw;
        try { data = JSON.parse(dataRaw); } catch {}
        return { value: { event: ev, id, data }, done: false };
      }
      if (done) return { value: undefined as any, done: true };
      const { done: rd, value } = await reader.read();
      if (rd) return { value: undefined as any, done: true };
      buf += td.decode(value);
    }
  }

  return {
    controller,
    async *[Symbol.asyncIterator]() {
      while (true) {
        const n = await next();
        if (n.done) return;
        yield n.value;
      }
    }
  };
}

// ==============================
// Tiny JS SDK helpers (run/stream)
// ==============================

export type RunOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  retries?: number; // number of retries on 5xx/network failures (default 0)
  fetchImpl?: typeof fetch; // for tests
  query?: Record<string, string | number | boolean>;
};

export async function run(input: any, opts: RunOptions): Promise<any> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = new URL('/v1/run', opts.baseUrl);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const retries = Math.max(0, Number(opts.retries ?? 0));
  const timeoutMs = Number(opts.timeoutMs || 0);
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = timeoutMs > 0 ? new AbortController() : undefined;
    const to = timeoutMs > 0 ? setTimeout(() => ac!.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(url.toString(), { method: 'POST', headers, body: JSON.stringify(input ?? {}), signal: ac?.signal });
      if (to) clearTimeout(to!);
      if (res.ok) return await res.json();
      if (res.status >= 500 && attempt < retries) { continue; }
      throw new Error(`http_${res.status}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
    } finally {
      if (to) try { clearTimeout(to!); } catch {}
    }
  }
  throw lastErr || new Error('run_failed');
}

export type StreamOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number; // overall timeout (optional)
  onEvent?: (ev: { event: string; id?: string; data?: any }) => void;
  onError?: (err: any) => void;
  signal?: AbortSignal;
  params?: Record<string, string | number | boolean>;
};

export async function stream(opts: StreamOptions): Promise<{ cancel: () => void }>
{
  const url = new URL('/v1/stream', opts.baseUrl);
  if (opts.params) for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { 'accept': 'text/event-stream' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const ac = new AbortController();
  const userSignal = opts.signal;
  const onAbort = () => { try { ac.abort(); } catch {} };
  if (userSignal) userSignal.addEventListener('abort', onAbort, { once: true });
  const to = opts.timeoutMs ? setTimeout(() => { try { ac.abort(); } catch {} }, opts.timeoutMs) : null;
  const res = await fetch(url.toString(), { headers, signal: ac.signal });
  if (!res.ok) throw new Error(`stream_http_${res.status}`);
  const reader = res.body!.getReader();
  let buf = '';
  const td = new TextDecoder();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value);
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let ev = '', id: string | undefined, dataRaw = '';
          for (const line of block.split('\n')) {
            const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
            if (k === 'event') ev = v; else if (k === 'id') id = v; else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
          }
          let data: any = dataRaw; try { data = JSON.parse(dataRaw); } catch {}
          opts.onEvent?.({ event: ev, id, data });
        }
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      if (to) try { clearTimeout(to); } catch {}
      if (userSignal) try { userSignal.removeEventListener('abort', onAbort as any); } catch {}
    }
  })();

  return { cancel: () => { try { reader.cancel(); } catch {} if (to) try { clearTimeout(to); } catch {} } };
}
