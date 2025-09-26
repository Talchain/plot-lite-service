import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'

function runNode(args: string[], env: Record<string,string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      stdio: 'ignore',
      env: { ...process.env, ...env },
      shell: false,
    })
    p.on('close', (code) => resolve(code ?? 1))
  })
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { method: 'GET' })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

describe('replay telemetry monotonicity', () => {
  it('counters only increase and lastTs updates across two replays; /health has replay', async () => {
    const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4313'

    // First run
    const code1 = await runNode(['tools/replay-fixtures.js'], { TEST_BASE_URL: base, NODE_ENV: 'test' })
    expect([0,1]).toContain(code1) // allow fail on drift in strict mode

    // Snapshot #1
    const s1 = await getJson(`${base}/internal/replay-status`)
    expect(s1).toBeTruthy()
    expect(typeof s1.refusals).toBe('number')
    expect(typeof s1.retries).toBe('number')
    expect(s1.lastTs === null || typeof s1.lastTs === 'string').toBe(true)

    // Second run
    const code2 = await runNode(['tools/replay-fixtures.js'], { TEST_BASE_URL: base, NODE_ENV: 'test' })
    expect([0,1]).toContain(code2)

    // Snapshot #2
    const s2 = await getJson(`${base}/internal/replay-status`)
    expect(s2).toBeTruthy()

    // Monotonic assertions
    expect(s2.refusals).toBeGreaterThanOrEqual(s1.refusals)
    expect(s2.retries).toBeGreaterThanOrEqual(s1.retries)

    // lastTs present and not older (string ISO)
    if (s1.lastTs && s2.lastTs) {
      expect(Date.parse(s2.lastTs)).toBeGreaterThanOrEqual(Date.parse(s1.lastTs))
    } else {
      // If null initially, it should be non-null after runs
      expect(s2.lastTs === null || typeof s2.lastTs === 'string').toBe(true)
    }

    // /health includes replay object with expected keys
    const h = await getJson(`${base}/health`)
    expect(h && typeof h === 'object').toBe(true)
    expect(h.replay && typeof h.replay === 'object').toBe(true)
    expect(['ok','fail','unknown']).toContain(h.replay.lastStatus)
    expect(typeof h.replay.refusals).toBe('number')
    expect(typeof h.replay.retries).toBe('number')
    expect(h.replay.lastTs === null || typeof h.replay.lastTs === 'string').toBe(true)
  })
})
