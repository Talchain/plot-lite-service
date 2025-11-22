#!/usr/bin/env tsx
import http from 'node:http';
import { URL } from 'node:url';
const PORT = Number(process.env.MOCK_PORT || 4390);
function writeSse(res, id, event, data) {
    res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, Number(ms) || 0))); }
const cancelled = new Set();
const state = new Map();
const server = http.createServer(async (req, res) => {
    try {
        const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
        if (u.pathname === '/health') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (u.pathname === '/stream/cancel' && req.method === 'POST') {
            let body = '';
            req.on('data', (c) => body += c);
            req.on('end', () => {
                const id = (() => { try {
                    return String(JSON.parse(body)?.id || u.searchParams.get('id') || '');
                }
                catch {
                    return String(u.searchParams.get('id') || '');
                } })();
                if (id)
                    cancelled.add(id);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
            });
            return;
        }
        if (u.pathname === '/stream') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            const id = String(u.searchParams.get('id') || 'default');
            const blip = (u.searchParams.get('blip') === '1') || (process.env.STREAM_BLIP === '1');
            const limitNow = (u.searchParams.get('limited') === '1');
            const sleepMs = Number(u.searchParams.get('sleepMs') || '0');
            if (limitNow) {
                writeSse(res, '0', 'limited', { reason: 'backpressure' });
                try {
                    res.end();
                }
                catch { }
                return;
            }
            const seq = [
                { ev: 'hello', body: { ts: new Date().toISOString() } },
                { ev: 'token', body: { text: 'draft', index: 0 } },
                { ev: 'cost', body: { tokens: 5, currency: 'USD', amount: 0.0 } },
                { ev: 'done', body: { reason: 'complete' } },
            ];
            const lastIdRaw = req.headers['last-event-id'];
            const lastId = lastIdRaw ? Number(lastIdRaw) : -1;
            const st = state.get(id) || { index: 0 };
            if (lastId >= 0)
                st.index = Math.min(seq.length, lastId + 1);
            state.set(id, st);
            for (let i = st.index; i < seq.length; i++) {
                if (cancelled.has(id)) {
                    writeSse(res, String(i), 'cancelled', { reason: 'client' });
                    try {
                        res.end();
                    }
                    catch { }
                    cancelled.delete(id);
                    state.set(id, { index: seq.length });
                    return;
                }
                const e = seq[i];
                await sleep(sleepMs);
                writeSse(res, String(i), e.ev, e.body);
                st.index = i + 1;
                state.set(id, st);
                if (blip && !st.blipped && e.ev === 'token') {
                    st.blipped = true;
                    state.set(id, st);
                    try {
                        res.end();
                    }
                    catch { }
                    return;
                }
            }
            try {
                res.end();
            }
            catch { }
            return;
        }
        res.statusCode = 404;
        res.end('not found');
    }
    catch (e) {
        res.statusCode = 500;
        res.end(e?.message || 'error');
    }
});
server.listen(PORT, '127.0.0.1', () => {
    console.log(`mock server listening on http://127.0.0.1:${PORT}`);
});
