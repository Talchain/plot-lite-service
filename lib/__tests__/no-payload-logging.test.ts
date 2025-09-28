import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'

function runServerAndCapture(port: string): { stop: () => void, getLogs: () => Promise<string> } {
  const logs: Buffer[] = []
  const child = spawn(process.execPath, ['tools/test-server.js'], {
    env: { ...process.env, TEST_PORT: port, TEST_ROUTES: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => logs.push(Buffer.from(d)))
  child.stderr.on('data', (d) => logs.push(Buffer.from(d)))
  function stop() { try { process.kill(child.pid!, 'SIGINT') } catch {} }
  async function getLogs() { return Buffer.concat(logs).toString('utf8') }
  return { stop, getLogs }
}

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('timeout')
}

describe('no payload logging: legacy POST /draft-flows does not log body tokens', () => {
  it('does not emit token-like string to logs', async () => {
    const PORT = '4332'
    const BASE = `http://127.0.0.1:${PORT}`
    const { stop, getLogs } = runServerAndCapture(PORT)
    try {
      await waitFor(`${BASE}/health`, 5000)
      const token = 'TOKEN-ABC-SECRET-123'
      const res = await fetch(`${BASE}/draft-flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 1, secret_token: token })
      })
      expect([200,400,503,504,500]).toContain(res.status) // allow various paths
      // give logger a moment
      await new Promise(r => setTimeout(r, 100))
      const logText = await getLogs()
      expect(logText.includes(token)).toBe(false)
    } finally {
      stop()
    }
  })
})
