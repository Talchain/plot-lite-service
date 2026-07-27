/**
 * WHY THE PORT IS ALLOCATED, NOT HARDCODED.
 *
 * This file used to bind a fixed `TEST_PORT=4353`. Whenever anything else on
 * the box already held 4353 — a stale PLoT server from another lane is the
 * common case — the test's own child failed to bind and exited, `/health` was
 * answered by the SQUATTER (any 200 satisfies the readiness poll), and
 * `/stream` came back 404. The failure then read as
 *
 *     AssertionError: expected 404 to be 200   at line "expect(r.status)..."
 *
 * i.e. exactly like a stream regression on the branch under test. Measured, not
 * inferred: with a dummy 200-on-/health / 404-elsewhere server on 4353, the
 * pristine file produces that assertion; with the same squatter still running,
 * this version passes.
 *
 * `getFreePort()` (tests/helpers/port-allocator.ts) binds port 0, reads the
 * kernel-assigned port and releases it.
 *
 * THE SECOND HALF, AND HONESTLY SCOPED. The file also had a `serverAvailable`
 * graceful skip, and that is a separate failure mode with the OPPOSITE sign: on
 * a port held by something that does NOT answer /health, the pristine file
 * SKIPS and the run reports "1 passed, 1 skipped" — a vacuous green. Measured
 * on a 404-everything holder of 4353:
 *
 *   pristine a5ffa60b   -> Test Files 1 PASSED, 1 skipped   (silently vacuous)
 *   this file           -> Test Files 1 FAILED, "test-server exited (code=1
 *                          ...) before .../health was ready — the port was
 *                          not bindable"
 *
 * So the readiness poll now watches the child's exit status and refuses to skip
 * over a dead child. What that guard does NOT do — measured, not assumed — is
 * win a race against a holder that answers /health 200 immediately: the poll
 * succeeds before the child's death is observable. That case is closed by the
 * port allocation above, not by this guard. Neither half covers for the other.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { getFreePort } from './helpers/port-allocator.js';

async function waitFor(url: string, proc: ChildProcess, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Fail LOUD on the one thing a fixed port used to hide: if the child is
    // gone, whatever answers this URL is not ours.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(
        `test-server exited (code=${proc.exitCode} signal=${proc.signalCode}) before ${url} was ready — the port was not bindable`,
      );
    }
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

function parseSse(text: string): Array<{ event: string; id?: string; data?: any }> {
  const out: Array<{ event: string; id?: string; data?: any }> = [];
  for (const block of String(text).split('\n\n')) {
    if (!block.trim()) continue;
    let ev = '', id: string | undefined, dataRaw = '';
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) { continue; }
      const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
      if (k === 'event') ev = v;
      else if (k === 'id') id = v;
      else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
    }
    let data: any = dataRaw;
    try { data = JSON.parse(dataRaw); } catch {}
    out.push({ event: ev, id, data });
  }
  return out;
}

describe('Real Stream: backpressure maps to limited and closes', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let serverAvailable = false;
  let BASE = '';

  beforeAll(async () => {
    const PORT = String(await getFreePort());
    BASE = `http://127.0.0.1:${PORT}`;
    const proc = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', STREAM_FORCE_LIMIT: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    child = proc;
    try {
      await waitFor(`${BASE}/health`, proc, 5000);
      serverAvailable = true;
    } catch (err) {
      // A child that EXITED could not bind. Skipping on that reports a vacuous
      // green (measured on pristine: "1 passed, 1 skipped"), so it fails loud
      // instead. A plain readiness timeout with the child still alive keeps the
      // original graceful skip — that tolerance is not this fix's to remove.
      if (proc.exitCode !== null || proc.signalCode !== null) throw err;
    }
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits terminal limited event then closes', async (ctx) => {
    if (!serverAvailable) { ctx.skip(); return; }
    const r = await fetch(`${BASE}/stream`);
    const txt = await r.text();
    expect(r.status).toBe(200);
    const events = parseSse(txt).map(e => e.event);
    expect(events).toContain('limited');
    // Expect not to have any events after 'limited'
    const limitedIdx = events.indexOf('limited');
    expect(limitedIdx).toBeGreaterThanOrEqual(0);
    expect(limitedIdx).toBe(events.length - 1);
  });
});
