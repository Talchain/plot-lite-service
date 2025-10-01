// Tiny Node SDK for PLoT-lite mock streaming
// openStream({ url, id, onEvent, onResume, onCancel, onError })
// Node 20: use fetch + Web Streams to parse SSE lines.
export async function openStream(opts) {
    const url = new URL(opts.url);
    if (opts.id)
        url.searchParams.set('id', String(opts.id));
    const init = { headers: { 'accept': 'text/event-stream', ...(opts.headers || {}) } };
    if (opts.lastEventId != null)
        init.headers['Last-Event-ID'] = String(opts.lastEventId);
    const res = await fetch(url, init);
    if (!(res.ok))
        throw new Error(`stream_http_${res.status}`);
    const reader = res.body.getReader();
    let buf = '';
    let cancelled = false;
    const pump = async () => {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += new TextDecoder().decode(value);
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
                const block = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                let ev = '', id, dataRaw = '';
                for (const line of block.split('\n')) {
                    const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
                    if (k === 'event')
                        ev = v;
                    else if (k === 'id')
                        id = v;
                    else if (k === 'data')
                        dataRaw += (dataRaw ? '\n' : '') + v;
                }
                let data = dataRaw;
                try {
                    data = JSON.parse(dataRaw);
                }
                catch { }
                opts.onEvent?.({ event: ev, id, data });
                if (ev === 'cancelled')
                    opts.onCancel?.();
                if (ev === 'token' && id)
                    opts.onResume?.(id);
            }
        }
    };
    pump().catch(err => opts.onError?.(err));
    return {
        cancel: () => { cancelled = true; try {
            reader.cancel();
        }
        catch { } }
    };
}
// Optional: async iterator over SSE events. Usage:
// for await (const ev of iterateStream({ url, id })) { ... }
// Supports Last-Event-ID for resume and returns a controller with cancel().
export async function iterateStream(opts) {
    const url = new URL(opts.url);
    if (opts.id != null)
        url.searchParams.set('id', String(opts.id));
    const init = { headers: { 'accept': 'text/event-stream', ...(opts.headers || {}) } };
    if (opts.lastEventId != null)
        init.headers['Last-Event-ID'] = String(opts.lastEventId);
    const res = await fetch(url, init);
    if (!res.ok)
        throw new Error(`stream_http_${res.status}`);
    const reader = res.body.getReader();
    let buf = '';
    let done = false;
    const td = new TextDecoder();
    const controller = { cancel: () => { try {
            reader.cancel();
        }
        catch { } done = true; } };
    async function next() {
        while (true) {
            const sepIdx = buf.indexOf('\n\n');
            if (sepIdx >= 0) {
                const block = buf.slice(0, sepIdx);
                buf = buf.slice(sepIdx + 2);
                let ev = '', id, dataRaw = '';
                for (const line of block.split('\n')) {
                    const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
                    if (k === 'event')
                        ev = v;
                    else if (k === 'id')
                        id = v;
                    else if (k === 'data')
                        dataRaw += (dataRaw ? '\n' : '') + v;
                }
                let data = dataRaw;
                try {
                    data = JSON.parse(dataRaw);
                }
                catch { }
                return { value: { event: ev, id, data }, done: false };
            }
            if (done)
                return { value: undefined, done: true };
            const { done: rd, value } = await reader.read();
            if (rd)
                return { value: undefined, done: true };
            buf += td.decode(value);
        }
    }
    return {
        controller,
        async *[Symbol.asyncIterator]() {
            while (true) {
                const n = await next();
                if (n.done)
                    return;
                yield n.value;
            }
        }
    };
}
