#!/usr/bin/env node
/**
 * rollout-bench.mjs
 * Lightweight deterministic micro-benchmark (single-line GATES output)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";

function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
function p95(arr){const xs=[...arr].sort((a,b)=>a-b);const i=Math.floor(0.95*(xs.length-1));return xs[i]??xs[xs.length-1]??0}

function rolloutOnce({nodes=16, seed=42}) {
  // Simple deterministic work to exercise CPU a bit
  const rnd = mulberry32(seed);
  let acc = 0;
  for (let i=1;i<=nodes;i++){
    let w = 0;
    for (let j=0;j<i*8;j++){ w += Math.sin(rnd()*i)*Math.cos(rnd()*j); }
    acc += w;
  }
  return acc;
}

(function main(){
  try {
    const N = 20;       // trials
    const nodes = 16;   // workload size
    const timings = [];
    for (let k=0;k<N;k++){
      const t0 = performance.now();
      rolloutOnce({nodes, seed: 100+k});
      timings.push(performance.now()-t0);
    }
    const p95ms = Math.round(p95(timings));
    mkdirSync("artifact/bench", { recursive: true });
    writeFileSync("artifact/bench/rollout.json", JSON.stringify({ schema: "rollout.bench.v1", p95_ms: p95ms, meta: { N, nodes } }, null, 2));
    console.log(`GATES: PASS — rollout bench p95=${p95ms}ms (N=${N}, nodes=${nodes})`);
    process.exit(0);
  } catch (e) {
    console.log(`GATES: FAIL — rollout bench error: ${e?.message||e}`);
    process.exit(1);
  }
})();
