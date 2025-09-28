import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'

function waitFor(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  return new Promise(async (resolve, reject) => {
    while (Date.now() - start < timeoutMs) {
      try { const r = await fetch(url); if (r.ok) return resolve() } catch {}
      await new Promise(r => setTimeout(r, 100))
    }
    reject(new Error('timeout'))
  })
}

describe('ready endpoint and cache-control header', () => {
  it('GET /ready returns 200 when server is ready; GET /draft-flows sends Cache-Control: no-cache', async () => {
    const PORT = '4331'
    const BASE = `http://127.0.0.1:${PORT}`
    const child = spawn(process.execPath, ['tools/test-server.js'], { stdio: 'ignore', env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1' }})
    try {
      await waitFor(`${BASE}/ready`, 5000)
      const res = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-cache')
    } finally {
      try { process.kill(child.pid!, 'SIGINT') } catch {}
    }
  })
})
