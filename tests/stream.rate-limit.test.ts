import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      const req = http.get(url, res => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
        } else {
          setTimeout(tick, 80);
        }
        res.resume();
      });
      req.on('error', () => setTimeout(tick, 80));
    };
    tick();
  });
}

describe('v1/stream rate limiting', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4369';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: {
        ...process.env,
        TEST_PORT: PORT,
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
        SSE_PER_IP_MAX: '2',
        SSE_GLOBAL_MAX: '100',
      },
      stdio: 'ignore',
    });
    await waitFor(`${BASE}/health`, 8000);
  });

  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('limits per IP after SSE_PER_IP_MAX concurrent streams', async () => {
    const openReqs: http.ClientRequest[] = [];
    const openRes: http.IncomingMessage[] = [];

    // open PER_IP_MAX connections and keep them open via latency
    for (let i = 0; i < 2; i++) {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${BASE}/v1/stream?latency_ms=2000`, res => {
          expect(res.statusCode).toBe(200);
          openReqs.push(req);
          openRes.push(res);
          resolve();
        });
        req.on('error', reject);
      });
    }

    // one more should be 429
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`${BASE}/v1/stream?latency_ms=2000`, res => {
        expect(res.statusCode).toBe(429);
        let body = '';
        res.on('data', c => (body += c.toString('utf8')));
        res.on('end', () => {
          try {
            const js = JSON.parse(body);
            expect(js?.schema).toBe('error.v1');
            expect(js?.code).toBe('RATE_LIMITED');
          } catch {}
          resolve();
        });
      });
      req.on('error', reject);
    });

    // cleanup
    for (const res of openRes) try { res.destroy(); } catch {}
    for (const req of openReqs) try { req.destroy(); } catch {}
  }, 15000);
});
