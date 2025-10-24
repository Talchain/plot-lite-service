#!/usr/bin/env node
import fs from 'node:fs';

const files = fs.readdirSync('.').filter(f => f.match(/^\.ci-run\d+\.txt$/)).sort();

if (files.length === 0) {
  console.error('No .ci-run*.txt files found');
  process.exit(1);
}

const fails = files.map(f => {
  const content = fs.readFileSync(f, 'utf8');
  const match = content.match(/Test Files\s+(\d+)\s+failed/);
  return match ? +match[1] : 0;
});

const mean = fails.reduce((a, b) => a + b, 0) / fails.length;
const variance = fails.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / fails.length;
const std = Math.sqrt(variance);
const worst = Math.max(...fails);
const best = Math.min(...fails);
const baseline = Math.max(worst, Math.ceil(mean + 2 * std));

console.log('\n=== Baseline Analysis ===');
console.log(`Runs: ${fails.length}`);
console.log(`Failures per run: ${fails.join(', ')}`);
console.log(`Best: ${best}`);
console.log(`Worst: ${worst}`);
console.log(`Mean: ${mean.toFixed(2)}`);
console.log(`Std Dev: ${std.toFixed(2)}`);
console.log(`Baseline (max(worst, mean+2σ)): ${baseline}`);
console.log(`Variance: ±${worst - best}`);
console.log('========================\n');

// Write summary
const summary = {
  runs: fails.length,
  failures: fails,
  best,
  worst,
  mean: +mean.toFixed(2),
  std: +std.toFixed(2),
  baseline,
  variance: worst - best
};

fs.writeFileSync('.baseline-summary.json', JSON.stringify(summary, null, 2));
console.log('Summary written to .baseline-summary.json');
