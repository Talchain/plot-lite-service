// Minimal JS SDK helpers (no deps)
// run(input, { baseUrl, token, timeoutMs, retries, query })
// stream({ baseUrl, token, timeoutMs, params, onEvent, onError, signal })

export async function run(input, opts) {
  const url = new URL('/v1/run', opts.baseUrl);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, String(v));
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const retries = Math.max(0, Number(opts.retries ?? 0));
  const timeoutMs = Number(opts.timeoutMs || 0);
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = timeoutMs > 0 ? new AbortController() : undefined;
    const to = timeoutMs > 0 ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(input ?? {}), signal: ac?.signal });
      if (to) clearTimeout(to);
      if (res.ok) return await res.json();
      if (res.status >= 500 && attempt < retries) continue;
      throw new Error(`http_${res.status}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
    } finally {
      if (to) try { clearTimeout(to); } catch {}
    }
  }
  throw lastErr || new Error('run_failed');
}

export async function stream(opts) {
  const url = new URL('/v1/stream', opts.baseUrl);
  if (opts.params) for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, String(v));
  const headers = { accept: 'text/event-stream' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const ac = new AbortController();
  const userSignal = opts.signal;
  const onAbort = () => { try { ac.abort(); } catch {} };
  if (userSignal) userSignal.addEventListener('abort', onAbort, { once: true });
  const to = opts.timeoutMs ? setTimeout(() => { try { ac.abort(); } catch {} }, opts.timeoutMs) : null;
  const res = await fetch(url.toString(), { headers, signal: ac.signal });
  if (!res.ok) throw new Error(`stream_http_${res.status}`);
  const reader = res.body.getReader();
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
          let ev = '', id = undefined, dataRaw = '';
          for (const line of block.split('\n')) {
            const [k, v] = line.split(':', 2).map(s => (s || '').trim());
            if (k === 'event') ev = v; else if (k === 'id') id = v; else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
          }
          let data = dataRaw; try { data = JSON.parse(dataRaw); } catch {}
          opts.onEvent?.({ event: ev, id, data });
        }
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      if (to) try { clearTimeout(to); } catch {}
      if (userSignal) try { userSignal.removeEventListener('abort', onAbort); } catch {}
    }
  })();
  return { cancel: () => { try { reader.cancel(); } catch {}; if (to) try { clearTimeout(to); } catch {} } };
}
