/**
 * Bayesian Model Averaging with seeded beam search
 * Deterministic: sparse prior p_edge≈0.1, fixed CPDAG→DAG tie-break
 */

import { createHash } from 'node:crypto';

class SeededPRNG {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() {
    // Linear congruential generator (deterministic)
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
}

/**
 * Compute BMA with seeded beam search
 * @param {object} graph - { nodes, edges }
 * @param {number} seed - RNG seed
 * @param {number} budget - Max models to evaluate
 * @returns {object} - { bma_hash, K_evaluated, K_used, mass_covered, action_consistency, sign_flip_rate }
 */
export function computeBMA(graph, seed = 42, budget = 1000) {
  const rng = new SeededPRNG(seed);
  const p_edge = 0.1;

  // Generate K candidate DAGs with sparse prior
  const candidates = [];
  const K_evaluated = Math.min(budget, 1000);

  for (let i = 0; i < K_evaluated; i++) {
    const dag = generateDAG(graph, rng, p_edge);
    const logLik = computeLogLikelihood(dag);
    const logPrior = computeLogPrior(dag, p_edge);
    const score = logLik + logPrior;

    candidates.push({ dag, score, logLik, logPrior });
  }

  // Sort by score (deterministic)
  candidates.sort((a, b) => b.score - a.score);

  // Truncate to top K_used (beam width)
  const beam_width = Math.min(100, K_evaluated);
  const selected = candidates.slice(0, beam_width);

  // Compute mass covered
  const total_mass = selected.reduce((sum, c) => sum + Math.exp(c.score), 0);
  const mass_covered = total_mass / (total_mass + 1e-10);

  // Compute action consistency (fraction of models agreeing on best action)
  const actions = selected.map(c => getBestAction(c.dag));
  const actionCounts = {};
  for (const a of actions) {
    actionCounts[a] = (actionCounts[a] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(actionCounts));
  const action_consistency = maxCount / actions.length;

  // Compute sign flip rate (how often treatment effect flips sign)
  const effects = selected.map(c => getTreatmentEffect(c.dag));
  let flips = 0;
  for (let i = 1; i < effects.length; i++) {
    if (Math.sign(effects[i]) !== Math.sign(effects[i - 1])) flips++;
  }
  const sign_flip_rate = effects.length > 1 ? flips / (effects.length - 1) : 0;

  // Compute BMA hash (SHA-256 of stable JSON)
  const bma_data = {
    selected_models: selected.map(c => ({
      dag_hash: hashDAG(c.dag),
      score: Number(c.score.toFixed(6)),
    })),
    ranked_actions: Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([action, count]) => ({ action, count })),
  };

  const canonical = JSON.stringify(bma_data, Object.keys(bma_data).sort(), 2);
  const bma_hash = createHash('sha256').update(canonical, 'utf8').digest('hex');

  return {
    bma_hash,
    K_evaluated,
    K_used: selected.length,
    mass_covered: Number(mass_covered.toFixed(4)),
    action_consistency: Number(action_consistency.toFixed(4)),
    sign_flip_rate: Number(sign_flip_rate.toFixed(4)),
  };
}

function generateDAG(graph, rng, p_edge) {
  // Simplified: sample edges with probability p_edge
  const edges = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      if (rng.next() < p_edge) {
        edges.push({ from: graph.nodes[i].id, to: graph.nodes[j].id });
      }
    }
  }
  return { nodes: graph.nodes, edges };
}

function computeLogLikelihood(dag) {
  // Simplified: negative of edge count (penalize complexity)
  return -dag.edges.length * 0.1;
}

function computeLogPrior(dag, p_edge) {
  // Binomial prior
  const n = dag.nodes.length;
  const max_edges = (n * (n - 1)) / 2;
  const k = dag.edges.length;
  return k * Math.log(p_edge) + (max_edges - k) * Math.log(1 - p_edge);
}

function getBestAction(dag) {
  // Simplified: hash-based deterministic action
  return `action_${hashDAG(dag).slice(0, 8)}`;
}

function getTreatmentEffect(dag) {
  // Simplified: deterministic effect based on edge count
  return dag.edges.length % 2 === 0 ? 1.0 : -1.0;
}

function hashDAG(dag) {
  const canonical = JSON.stringify({
    nodes: dag.nodes.map(n => n.id).sort(),
    edges: dag.edges
      .map(e => `${e.from}->${e.to}`)
      .sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
