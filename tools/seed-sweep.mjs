#!/usr/bin/env node
/**
 * Track S — Monte Carlo seed-sweep & ISL determinism harness (read-only).
 *
 * Gathers stability evidence for surfaced probabilities by driving the LIVE
 * /v2/run endpoint (which forwards n_samples + seed to the remote ISL service,
 * where the actual Monte Carlo runs). Local tests mock ISL with seed-invariant
 * canned responses and therefore CANNOT produce stability evidence — hence this
 * harness targets a deployed service. It performs NO deployment and only issues
 * POST /v2/run requests (no Idempotency-Key, so each call genuinely re-runs ISL).
 *
 * Modes:
 *   validate  — one call per fixture; confirm analysis_status=computed and report
 *               which fixtures produce flip_thresholds (need observed_state).
 *   precheck  — ISL seed-determinism gate: repeated IDENTICAL (seed,depth) calls
 *               on one fixture. Compares full-precision outcome.mean +
 *               recommendation_stability + displayed win_probability. If repeated
 *               identical calls vary materially the full sweep is not interpretable.
 *   sweep     — full matrix: fixtures x depths x seeds. Aggregates win-prob spread,
 *               winner/ranking stability, near-tie behaviour, factor-sensitivity
 *               stability, robustness-band stability, latency p50/p95, timeouts.
 *
 * Usage:
 *   node tools/seed-sweep.mjs --mode=validate
 *   node tools/seed-sweep.mjs --mode=precheck [--fixture=clear-winner] [--depth=1000] [--repeats=8]
 *   node tools/seed-sweep.mjs --mode=sweep [--depths=1000,2000,4000] [--seeds=...] [--fixtures=...]
 *
 * Flags:
 *   --base=URL        default https://plot-lite-service-staging.onrender.com
 *   --out=DIR         default tools/seed-sweep-out
 *   --min-interval=MS min ms between requests (rate-limit pacing; default 1100 → <60rpm)
 *   --flip            in sweep mode, also run the flip-stability subset
 *
 * Output: <out>/<mode>-<timestamp>.json (raw + aggregates) and, for sweep, a .md report.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const BASE = String(args.base ?? 'https://plot-lite-service-staging.onrender.com').replace(/\/$/, '');
const OUT_DIR = String(args.out ?? 'tools/seed-sweep-out');
const MIN_INTERVAL_MS = Number(args['min-interval'] ?? 1100); // <60 rpm safety
const MODE = String(args.mode ?? 'validate');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const DEFAULT_SEEDS = [11, 101, 202, 303, 404, 505, 606, 707, 808, 909, 1234, 4242];
const DEFAULT_DEPTHS = [1000, 2000, 4000];

const SEEDS = args.seeds ? String(args.seeds).split(',').map(Number) : DEFAULT_SEEDS;
const DEPTHS = args.depths ? String(args.depths).split(',').map(Number) : DEFAULT_DEPTHS;

// ---------------------------------------------------------------------------
// Fixtures — 4 categories. F4 carries observed_state (→ parameter_uncertainties
// → flip candidates) AND a goal_constraint, covering "constrained" + flip subset.
// ---------------------------------------------------------------------------
const FIXTURES = {
  'clear-winner': {
    desc: 'One option strongly dominant (expect ~0.16/0.84).',
    graph: {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A' },
        { id: 'factor-b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
      { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
  },
  'near-tie': {
    desc: 'Symmetric graph + symmetric interventions (expect ~50/50).',
    graph: {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A' },
        { id: 'factor-b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.85, strength: { mean: 0.6, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.85, strength: { mean: 0.6, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
      { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
  },
  'multi-option': {
    desc: 'Three options on three factors of increasing strength.',
    graph: {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A' },
        { id: 'factor-b', kind: 'factor', label: 'Factor B' },
        { id: 'factor-c', kind: 'factor', label: 'Factor C' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.4, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.8, strength: { mean: 0.55, std: 0.1 } },
        { from: 'factor-c', to: 'goal', exists_probability: 0.8, strength: { mean: 0.7, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
      { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
      { id: 'opt3', label: 'Option 3', interventions: { 'factor-c': { value: 2.0, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
  },
  constrained: {
    desc: 'Factors with observed_state (→ flip candidates) + a goal_constraint.',
    graph: {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 1.0, std: 0.3 } },
        { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 1.0, std: 0.3 } },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.85, strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.85, strength: { mean: 0.65, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
      { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 1.8, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
    goal_constraints: [{ constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.3 }],
  },
};

// Representative larger graph (closer to upper PoC size) for the PR-E latency
// gate: 20 factors → goal, plus inter-factor edges for propagation depth, 4
// options. No observed_state (pure base analysis — isolates the depth effect).
FIXTURES.large = (() => {
  const N = 20;
  const nodes = [{ id: 'goal', kind: 'goal', label: 'Goal' }];
  const edges = [];
  for (let i = 0; i < N; i++) {
    const id = `f${String(i).padStart(2, '0')}`;
    nodes.push({ id, kind: 'factor', label: `Factor ${i}` });
    edges.push({ from: id, to: 'goal', exists_probability: 0.7 + (i % 3) * 0.1, strength: { mean: 0.2 + (i % 5) * 0.12, std: 0.1 } });
  }
  // inter-factor edges (f_i → f_{i+5}) add propagation depth
  for (let i = 0; i + 5 < N; i += 2) {
    edges.push({ from: `f${String(i).padStart(2, '0')}`, to: `f${String(i + 5).padStart(2, '0')}`, exists_probability: 0.6, strength: { mean: 0.3, std: 0.1 } });
  }
  const options = [0, 5, 10, 15].map((base, k) => ({
    id: `opt${k + 1}`,
    label: `Option ${k + 1}`,
    interventions: {
      [`f${String(base).padStart(2, '0')}`]: { value: 1.5 + k * 0.2, source: 'user_specified' },
      [`f${String(base + 1).padStart(2, '0')}`]: { value: 1.2, source: 'user_specified' },
    },
  }));
  return { desc: `${N}-factor PoC-scale graph, 4 options (base-analysis latency gate).`, graph: { nodes, edges }, options, goal_node_id: 'goal' };
})();

// ---------------------------------------------------------------------------
// HTTP with pacing + 429 backoff
// ---------------------------------------------------------------------------
let lastCallAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pace() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function runOnce(fixtureKey, seed, nSamples, { includeThresholds = false } = {}) {
  const fx = FIXTURES[fixtureKey];
  const body = {
    graph: fx.graph,
    options: fx.options,
    goal_node_id: fx.goal_node_id,
    seed: String(seed),
    n_samples: nSamples,
  };
  if (fx.goal_constraints) body.goal_constraints = fx.goal_constraints;
  if (includeThresholds) body.include_thresholds = true;

  for (let attempt = 0; attempt < 4; attempt++) {
    await pace();
    const t0 = Date.now();
    let res, json, status;
    try {
      res = await fetch(`${BASE}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = res.status;
      if (status === 429) {
        const backoff = 5000 * (attempt + 1);
        process.stderr.write(`  429 rate-limited; backoff ${backoff}ms\n`);
        await sleep(backoff);
        continue;
      }
      json = await res.json();
    } catch (err) {
      process.stderr.write(`  fetch error (attempt ${attempt}): ${err.message}\n`);
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const wallMs = Date.now() - t0;
    return extractSignals(json, { http_status: status, wall_ms: wallMs, seed, n_samples: nSamples, fixture: fixtureKey });
  }
  return { fixture: fixtureKey, seed, n_samples: nSamples, http_status: 'FAILED', error: 'exhausted retries' };
}

function argmaxWinner(optionComparison) {
  let best = null;
  for (const o of optionComparison ?? []) {
    const wp = o.win_probability;
    if (wp == null || !Number.isFinite(wp)) continue;
    if (!best || wp > best.wp || (wp === best.wp && (o.option_id ?? o.id) < best.id)) {
      best = { id: o.option_id ?? o.id, wp };
    }
  }
  return best?.id ?? null;
}

function extractSignals(json, ctx) {
  const oc = json.option_comparison ?? [];
  const rob = json.robustness ?? {};
  const fs = json.factor_sensitivity ?? [];
  const flips = json.flip_thresholds ?? [];
  const winProbs = {};
  const outcomeMeans = {};
  for (const o of oc) {
    const id = o.option_id ?? o.id;
    if (id == null) continue;
    winProbs[id] = o.win_probability ?? null;
    outcomeMeans[id] = o.outcome?.mean ?? null;
  }
  // ranking by win_probability (desc, tie-break by id)
  const ranking = Object.entries(winProbs)
    .filter(([, v]) => v != null && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);

  return {
    ...ctx,
    analysis_status: json.analysis_status ?? null,
    response_hash: json.response_hash ?? null,
    meta_n_samples: json.meta?.n_samples ?? null,
    seed_used: json.meta?.seed_used ?? null,
    isl_ms: json.meta?.isl_ms ?? null,
    latency_ms: json.meta?.latency_ms ?? null,
    processing_time_ms: json.processing_time_ms ?? null,
    winner: rob.recommended_option_id ?? argmaxWinner(oc),
    ranking,
    win_probabilities: winProbs,
    outcome_means: outcomeMeans,
    recommendation_stability: rob.recommendation_stability ?? null,
    robustness_level: rob.level ?? null,
    robustness_confidence: rob.confidence ?? null,
    near_tie: rob.near_tie?.is_tie ?? null,
    near_tie_gap: rob.near_tie?.gap ?? null,
    factor_elasticities: fs.map((f) => f.elasticity ?? null),
    factor_ranks: fs.map((f) => f.importance_rank ?? null),
    flip_status: json.flip_thresholds_status ?? null,
    flip_count: flips.length,
    flip_timeouts: flips.filter((f) => f.flip_reason === 'timeout').length,
    flip_values: flips.map((f) => ({ factor: f.factor_id ?? f.node_id ?? null, flip_value: f.flip_value ?? null, reason: f.flip_reason ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
const pct = (arr, p) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[idx];
};
const mean = (arr) => { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
const stddev = (arr) => { const a = arr.filter(Number.isFinite); if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const spread = (arr) => { const a = arr.filter(Number.isFinite); return a.length ? Math.max(...a) - Math.min(...a) : null; };
const modal = (arr) => { const c = {}; let best = null; for (const x of arr) { const k = String(x); c[k] = (c[k] ?? 0) + 1; if (!best || c[k] > c[best]) best = k; } return { value: best, count: c[best] ?? 0, total: arr.length }; };
const round = (x, n = 4) => (x == null || !Number.isFinite(x) ? x : Number(x.toFixed(n)));

function writeOut(name, data) {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return p;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
async function modeValidate() {
  process.stderr.write(`[validate] base=${BASE}\n`);
  const results = [];
  for (const key of Object.keys(FIXTURES)) {
    const r = await runOnce(key, 42, 1000, { includeThresholds: true });
    results.push(r);
    process.stderr.write(
      `  ${key.padEnd(13)} status=${r.analysis_status} winner=${r.winner} winp=${JSON.stringify(r.win_probabilities)} flips=${r.flip_count}(${r.flip_status})\n`
    );
  }
  const p = writeOut(`validate-${STAMP}.json`, { base: BASE, results });
  process.stderr.write(`[validate] wrote ${p}\n`);
}

async function modePrecheck() {
  const fixture = String(args.fixture ?? 'clear-winner');
  const depth = Number(args.depth ?? 1000);
  const repeats = Number(args.repeats ?? 8);
  const seed = Number(args.seed ?? 42);
  process.stderr.write(`[precheck] fixture=${fixture} depth=${depth} seed=${seed} repeats=${repeats}\n`);

  const calls = [];
  for (let i = 0; i < repeats; i++) {
    const r = await runOnce(fixture, seed, depth);
    calls.push(r);
    process.stderr.write(
      `  #${i} winp=${JSON.stringify(r.win_probabilities)} mean=${JSON.stringify(Object.fromEntries(Object.entries(r.outcome_means).map(([k, v]) => [k, round(v, 6)])))} recstab=${round(r.recommendation_stability, 6)} hash=${r.response_hash}\n`
    );
  }

  // Compare across identical calls
  const optIds = Object.keys(calls[0].win_probabilities ?? {});
  const winpSpread = {};
  const meanSpread = {};
  for (const id of optIds) {
    winpSpread[id] = spread(calls.map((c) => c.win_probabilities[id]));
    meanSpread[id] = spread(calls.map((c) => c.outcome_means[id]));
  }
  const recStabSpread = spread(calls.map((c) => c.recommendation_stability));
  const hashes = new Set(calls.map((c) => c.response_hash));
  const winners = new Set(calls.map((c) => c.winner));

  const maxWinp = Math.max(...Object.values(winpSpread).map((x) => x ?? 0));
  const maxMean = Math.max(...Object.values(meanSpread).map((x) => x ?? 0));

  // Verdict
  let verdict, note;
  if (maxWinp === 0 && maxMean < 1e-9) {
    verdict = 'PASS-DETERMINISTIC';
    note = 'ISL is bit-for-bit seed-deterministic at fixed seed/depth. Full sweep fully interpretable.';
  } else if (maxWinp === 0) {
    verdict = 'PASS-DISPLAY-STABLE';
    note = `Displayed win_probability is identical across identical calls (sub-display ISL noise ${maxMean.toExponential(2)} in outcome.mean). Sweep interpretable at display precision; attribute sub-0.01 wobble to ISL noise.`;
  } else if (maxWinp <= 0.01) {
    verdict = 'MARGINAL';
    note = `Displayed win_probability varies by up to ${(maxWinp * 100).toFixed(1)}pp across IDENTICAL calls — at the 0.01 quantisation boundary. Sweep spread within ~1pp is not attributable to seed. Proceed with caution.`;
  } else {
    verdict = 'HALT';
    note = `Displayed win_probability varies by up to ${(maxWinp * 100).toFixed(1)}pp across IDENTICAL (seed,depth) calls. ISL is NOT acceptably seed-deterministic — the seed sweep would conflate seed sensitivity with ISL run-to-run noise. HALT and report.`;
  }

  const summary = {
    fixture, depth, seed, repeats,
    distinct_response_hashes: [...hashes],
    distinct_winners: [...winners],
    win_probability_spread_pp: Object.fromEntries(Object.entries(winpSpread).map(([k, v]) => [k, round((v ?? 0) * 100, 3)])),
    outcome_mean_spread: Object.fromEntries(Object.entries(meanSpread).map(([k, v]) => [k, round(v, 9)])),
    recommendation_stability_spread: round(recStabSpread, 9),
    max_displayed_winp_spread_pp: round(maxWinp * 100, 3),
    max_outcome_mean_spread: round(maxMean, 9),
    verdict, note,
  };
  const p = writeOut(`precheck-${STAMP}.json`, { base: BASE, summary, calls });
  process.stderr.write(`\n[precheck] VERDICT=${verdict}\n  ${note}\n[precheck] wrote ${p}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

async function modeSweep() {
  const fixtures = args.fixtures ? String(args.fixtures).split(',') : Object.keys(FIXTURES);
  process.stderr.write(`[sweep] fixtures=${fixtures.join(',')} depths=${DEPTHS.join(',')} seeds=${SEEDS.length} (${SEEDS.join(',')})\n`);
  const raw = [];
  const total = fixtures.length * DEPTHS.length * SEEDS.length;
  let i = 0;
  for (const fx of fixtures) {
    for (const depth of DEPTHS) {
      for (const seed of SEEDS) {
        const r = await runOnce(fx, seed, depth, { includeThresholds: !!args.flip });
        raw.push(r);
        i++;
        if (i % 10 === 0 || i === total) process.stderr.write(`  ${i}/${total} (${fx} d=${depth} s=${seed} status=${r.analysis_status})\n`);
      }
    }
  }

  // Aggregate per (fixture, depth)
  const cells = [];
  for (const fx of fixtures) {
    for (const depth of DEPTHS) {
      const rows = raw.filter((r) => r.fixture === fx && r.n_samples === depth && r.analysis_status === 'computed');
      if (!rows.length) { cells.push({ fixture: fx, depth, n: 0, note: 'no computed rows' }); continue; }
      const optIds = Object.keys(rows[0].win_probabilities);
      const winnerModal = modal(rows.map((r) => r.winner));
      const rankingModal = modal(rows.map((r) => r.ranking.join('>')));
      const perOption = {};
      for (const id of optIds) {
        const wps = rows.map((r) => r.win_probabilities[id]).filter(Number.isFinite);
        perOption[id] = {
          mean_pp: round(mean(wps) * 100, 2),
          min_pp: round(Math.min(...wps) * 100, 2),
          max_pp: round(Math.max(...wps) * 100, 2),
          spread_pp: round(spread(wps) * 100, 2),
          stddev_pp: round(stddev(wps) * 100, 2),
        };
      }
      // winner win-prob spread (the headline number)
      const winnerWps = rows.map((r) => r.win_probabilities[r.winner]).filter(Number.isFinite);
      const walls = rows.map((r) => r.wall_ms);
      const islms = rows.map((r) => r.isl_ms).filter(Number.isFinite);
      cells.push({
        fixture: fx, depth, n: rows.length,
        winner_modal: winnerModal.value, winner_stability: round(winnerModal.count / winnerModal.total, 3),
        ranking_modal: rankingModal.value, ranking_stability: round(rankingModal.count / rankingModal.total, 3),
        winner_winp_spread_pp: round(spread(winnerWps) * 100, 2),
        winner_winp_stddev_pp: round(stddev(winnerWps) * 100, 2),
        per_option: perOption,
        near_tie_fraction: round(mean(rows.map((r) => (r.near_tie ? 1 : 0))), 3),
        near_tie_gap_spread: round(spread(rows.map((r) => r.near_tie_gap)), 4),
        robustness_band: modal(rows.map((r) => r.robustness_level)),
        recommendation_stability_mean: round(mean(rows.map((r) => r.recommendation_stability)), 4),
        recommendation_stability_spread: round(spread(rows.map((r) => r.recommendation_stability)), 4),
        rank1_elasticity_spread: round(spread(rows.map((r) => r.factor_elasticities[0])), 4),
        latency_wall_p50_ms: pct(walls, 50), latency_wall_p95_ms: pct(walls, 95),
        isl_p50_ms: pct(islms, 50), isl_p95_ms: pct(islms, 95),
        flip_timeouts_total: rows.reduce((s, r) => s + (r.flip_timeouts ?? 0), 0),
        non_computed: raw.filter((r) => r.fixture === fx && r.n_samples === depth && r.analysis_status !== 'computed').length,
      });
    }
  }

  // Latency by depth (across all fixtures)
  const latencyByDepth = DEPTHS.map((depth) => {
    const rows = raw.filter((r) => r.n_samples === depth && r.analysis_status === 'computed');
    return {
      depth, n: rows.length,
      wall_p50_ms: pct(rows.map((r) => r.wall_ms), 50),
      wall_p95_ms: pct(rows.map((r) => r.wall_ms), 95),
      isl_p50_ms: pct(rows.map((r) => r.isl_ms).filter(Number.isFinite), 50),
      isl_p95_ms: pct(rows.map((r) => r.isl_ms).filter(Number.isFinite), 95),
    };
  });

  const out = { base: BASE, seeds: SEEDS, depths: DEPTHS, fixtures, cells, latencyByDepth, raw };
  const pj = writeOut(`sweep-${STAMP}.json`, out);
  const pm = writeOut(`sweep-${STAMP}.md`, renderReport(out));
  process.stderr.write(`[sweep] wrote ${pj}\n[sweep] wrote ${pm}\n`);
  console.log(renderReport(out));
}

function renderReport(out) {
  const L = [];
  L.push(`# Track S — Seed-sweep evidence`);
  L.push(``);
  L.push(`- Target: \`${out.base}/v2/run\` (live ISL behind it). Read-only; no deploy.`);
  L.push(`- Seeds (${out.seeds.length}): ${out.seeds.join(', ')}`);
  L.push(`- Depths: ${out.depths.join(', ')}`);
  L.push(``);
  L.push(`## Latency by depth (all fixtures, computed only)`);
  L.push(`| depth | n | wall p50 | wall p95 | isl p50 | isl p95 |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const d of out.latencyByDepth) L.push(`| ${d.depth} | ${d.n} | ${d.wall_p50_ms}ms | ${d.wall_p95_ms}ms | ${d.isl_p50_ms}ms | ${d.isl_p95_ms}ms |`);
  L.push(``);
  L.push(`## Stability per fixture × depth`);
  L.push(`Thresholds: ±3pp ok for display; >±5pp ⇒ fragile. p50≤3s/p95≤6s preferred; p95>8s hard warn.`);
  L.push(`| fixture | depth | n | winner | win-stab | rank-stab | winner winp spread (pp) | winner winp σ (pp) | near-tie frac | robustness | rec-stab spread | wall p95 | flip TO |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const c of out.cells) {
    if (!c.n) { L.push(`| ${c.fixture} | ${c.depth} | 0 | — | — | — | — | — | — | — | — | — | — |`); continue; }
    L.push(`| ${c.fixture} | ${c.depth} | ${c.n} | ${c.winner_modal} | ${c.winner_stability} | ${c.ranking_stability} | ${c.winner_winp_spread_pp} | ${c.winner_winp_stddev_pp} | ${c.near_tie_fraction} | ${c.robustness_band.value}(${c.robustness_band.count}/${c.robustness_band.total}) | ${c.recommendation_stability_spread} | ${c.latency_wall_p95_ms}ms | ${c.flip_timeouts_total} |`);
  }
  L.push(``);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
const MODES = { validate: modeValidate, precheck: modePrecheck, sweep: modeSweep };
const fn = MODES[MODE];
if (!fn) { process.stderr.write(`unknown --mode=${MODE}\n`); process.exit(1); }
fn().catch((e) => { process.stderr.write(`FATAL: ${e.stack || e}\n`); process.exit(1); });
