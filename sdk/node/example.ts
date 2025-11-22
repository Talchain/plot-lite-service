import { openStream } from './index.js';

async function main() {
  const port = Number(process.env.MOCK_PORT || 4390);
  const base = `http://127.0.0.1:${port}/stream`;
  let lastId: string | number | undefined;
  const ctl = await openStream({
    url: base,
    id: 'sample-1',
    onEvent: (e) => { console.log('event', e.event, e.id, e.data); lastId = e.id ?? lastId; },
    onResume: (id) => { console.log('resumeFrom', id); },
    onCancel: () => { console.log('cancelled'); },
    onError: (err) => { console.error('err', err?.message || String(err)); }
  });
  // Auto-cancel after 1s
  setTimeout(() => { try { ctl.cancel(); } catch {} }, 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
