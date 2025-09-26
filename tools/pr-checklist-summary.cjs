#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('node:child_process')

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4311'

function get(url){
  const res = spawnSync(process.execPath, ['-e', `
    (async () => {
      const r = await fetch(${JSON.stringify(url)});
      const txt = await r.text();
      console.log(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: txt.slice(0, 2000) }))
    })().catch(e => { console.error('ERR', e?.message||String(e)); process.exit(1) })
  `], { encoding: 'utf8' })
  if (res.status !== 0) return { error: res.stderr || res.stdout }
  try { return JSON.parse(res.stdout.trim()) } catch { return { raw: res.stdout } }
}

function printMarkdown(summary){
  const hdr = '### PR Checklist Summary\n\n'
  process.stdout.write(hdr + summary + '\n')
}

(function main(){
  const first = get(`${BASE}/draft-flows?template=pricing_change&seed=101`)
  const etag = first?.headers?.etag
  const second = get(`${BASE}/draft-flows?template=pricing_change&seed=101`)
  const cc = first?.headers?.['cache-control'] || first?.headers?.['Cache-Control']
  const health = get(`${BASE}/health`)
  const ready = get(`${BASE}/ready`)

  const ok304 = etag && second && second.status === 200 // cannot set If-None-Match via this quick helper; rely on tests instead
  const healthOk = health?.status === 200 && typeof JSON.parse(health.body||'{}').p95_ms === 'number'
  const readyOk = ready?.status === 200

  const lines = [
    `- ETag present on GET /draft-flows: ${etag ? 'yes' : 'no'}`,
    `- Cache-Control no-cache: ${cc === 'no-cache' ? 'yes' : 'no'} (value: ${cc||'n/a'})`,
    `- /health keys present (p95_ms): ${healthOk ? 'yes' : 'no'}`,
    `- /ready 200: ${readyOk ? 'yes' : 'no'}`
  ]
  printMarkdown(lines.map(s => `* ${s}`).join('\n'))
})()
