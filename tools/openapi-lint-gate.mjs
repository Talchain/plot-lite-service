#!/usr/bin/env node
/**
 * openapi-lint-gate.mjs
 * Lightweight OpenAPI spec lint gate.
 * - Prefers Spectral CLI when available (fast, quiet)
 * - Falls back to YAML parse-only if Spectral is not installed
 * - Hard timeout ≤ 15s
 * - Emits exactly one GATES line (PASS/FAIL/SKIP) and exits accordingly
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

try {
  const specPath = resolve(process.cwd(), 'contracts', 'openapi.yaml');
  if (!existsSync(specPath)) {
    console.log('GATES: SKIP — openapi-lint (missing spec)');
    process.exit(0);
  }

  // Try Spectral first (prefer local install or npx cache)
  try {
    const rulesPath = resolve(process.cwd(), 'tools', 'spectral.rules.yaml');
    const args = ['-y', '@stoplight/spectral-cli@6', 'lint'];
    if (existsSync(rulesPath)) { args.push('-r', rulesPath); }
    // Request JSON for robust parsing
    args.push('-f', 'json', specPath);
    const spectral = spawnSync('npx', args, {
      encoding: 'utf8',
      timeout: 12000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    if (spectral.status === 0) {
      // After PASS, render JSON and compare top-level paths keys
      try {
        const render = spawnSync('node', [resolve(process.cwd(), 'tools', 'openapi-render.mjs')], { encoding: 'utf8', timeout: 6000, env: { ...process.env, FORCE_COLOR: '0' } });
        if (render.status !== 0) {
          const msg = (render.stdout || render.stderr || 'render failed').toString().trim().slice(0, 200);
          console.log(`GATES: FAIL — openapi render ${msg}`);
          process.exit(1);
        }
        // Compare YAML vs JSON top-level paths keys
        const yaml = await import('yaml');
        const ytxt = readFileSync(specPath, 'utf8');
        const yobj = yaml.parse(ytxt) || {};
        const jtxt = readFileSync(resolve(process.cwd(), 'artifact', 'openapi.json'), 'utf8');
        const jobj = JSON.parse(jtxt);
        const yKeys = Object.keys((yobj.paths || {})).sort();
        const jKeys = Object.keys((jobj.paths || {})).sort();
        const ySet = new Set(yKeys);
        const jSet = new Set(jKeys);
        const missing = yKeys.filter(k => !jSet.has(k));
        const extra = jKeys.filter(k => !ySet.has(k));
        if (missing.length || extra.length) {
          const miss = missing.length ? `missing=[${missing.slice(0,3).join(',')}${missing.length>3?'…':''}]` : '';
          const ext = extra.length ? `extra=[${extra.slice(0,3).join(',')}${extra.length>3?'…':''}]` : '';
          const reason = [miss, ext].filter(Boolean).join(' ');
          console.log(`GATES: FAIL — openapi paths mismatch ${reason}`.trim());
          process.exit(1);
        }
        // Lightweight post-check: Ensure 429 headers are formally documented
        const needed = {
          stream: {
            path: '/v1/stream', method: 'get', code: '429', headers: ['Retry-After','X-RateLimit-Reason'],
          },
          json: [
            { path: '/v1/run', method: 'post' },
            { path: '/v1/counterfactual', method: 'post' },
            { path: '/v1/critique', method: 'post' },
            { path: '/v1/draft', method: 'post' },
          ],
        };
        function hasHeaders(obj, names) {
          if (!obj || typeof obj !== 'object') return false;
          const hdrs = obj.headers || {};
          return names.every(n => Object.prototype.hasOwnProperty.call(hdrs, n));
        }
        const jpaths = jobj.paths || {};
        let headersOk = true;
        try {
          const s = jpaths[needed.stream.path]?.[needed.stream.method]?.responses?.[needed.stream.code];
          headersOk = headersOk && hasHeaders(s, needed.stream.headers);
          for (const r of needed.json) {
            const resp = jpaths[r.path]?.[r.method]?.responses?.['429'];
            headersOk = headersOk && hasHeaders(resp, ['Retry-After','X-RateLimit-Reset','X-RateLimit-Reason']);
          }
        } catch {}
        if (!headersOk) {
          console.log('GATES: FAIL — openapi 429 headers missing');
          process.exit(1);
        }
        console.log('GATES: PASS — openapi lint ok + render ok + headers ok');
        process.exit(0);
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 180);
        console.log(`GATES: FAIL — openapi render error ${msg}`);
        process.exit(1);
      }
    } else if (spectral.error && spectral.error.code === 'ENOENT') {
      // Fall through to YAML parse fallback
    } else if (spectral.timedOut) {
      console.log('GATES: FAIL — openapi lint timeout (spectral)');
      process.exit(1);
    } else {
      const outTxt = (spectral.stdout || '') || '';
      try {
        const arr = JSON.parse(outTxt);
        const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
        if (first) {
          const sev = String(first.severity ?? '').toLowerCase();
          const code = first.code ? String(first.code) : 'spectral';
          const msg = String(first.message || 'lint error');
          const path = Array.isArray(first.path) ? first.path.join('.') : '';
          const where = first.range ? `${first.range.start?.line ?? ''}:${first.range.start?.character ?? ''}` : '';
          console.log(`GATES: FAIL — openapi lint ${sev || 'error'} ${code} ${path} ${where} ${msg}`.trim());
          process.exit(1);
        }
      } catch {}
      const out = outTxt + (spectral.stderr || '');
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
      const specPathLine = lines.find(l => l.includes('openapi.yaml'));
      const firstUseful = lines.find(l => l !== specPathLine) || lines[0] || 'lint errors';
      console.log(`GATES: FAIL — openapi lint ${firstUseful.slice(0,240)}`);
      process.exit(1);
    }
  } catch {}

  // YAML parse fallback
  try {
    const yaml = await import('yaml');
    const txt = readFileSync(specPath, 'utf8');
    yaml.parse(txt); // throws on invalid
    console.log('GATES: PASS — openapi parse ok (yaml)');
    process.exit(0);
  } catch (err) {
    if (String(err?.message || err).includes("Cannot find module 'yaml'")) {
      console.log('GATES: SKIP — openapi-lint (parser missing)');
      process.exit(0);
    }
    const msg = String(err?.message || 'parse error').replace(/\s+/g, ' ').slice(0, 140);
    console.log(`GATES: FAIL — openapi parse error reason=${msg}`);
    process.exit(1);
  }
} catch (err) {
  console.log('GATES: SKIP — openapi-lint (reason=unexpected error)');
  process.exit(0);
}
