import { createHash, randomUUID } from 'node:crypto';
import { buildModelCard, getActiveFeatureFlags } from '../trust/model-card.js';
import { calculateConfidence } from '../trust/confidence.js';
import { buildCritique } from '../trust/critique-builder.js';
import { buildExplainDelta } from '../trust/explain-delta.js';
import { checkLinearity, detectThresholdCrossings, generateForkSuggestions } from '../trust/linearity.js';
import { checkIdentifiability } from '../trust/identifiability.js';
import { enforceComputeBudget } from '../governance/cost-estimator.js';
import { stableStringify, normaliseReport } from '../util/canonical-json.js';
import type { Graph } from '../trust/types.js';

export interface ExecuteRunInput {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
}

export interface ExecuteRunOptions {
  signal?: AbortSignal | null;
  onProgress?: (pct: number) => void;
  onInterim?: (partial: any) => void;
}

async function yieldTick(){
  await new Promise<void>((resolve) => {
    try { setTimeout(resolve, 0); } catch { resolve(); }
  });
}

export async function executeRun(input: ExecuteRunInput, opts: ExecuteRunOptions = {}) {
  const start = performance.now();
  const { graph, seed = 42, k_samples = 1000 } = input as any;
  const treatment_node = input.treatment_node ?? graph.nodes[0]?.id;
  const outcome_node = input.outcome_node ?? graph.nodes[graph.nodes.length - 1]?.id;
  const baseline_value = input.baseline_value ?? 100;

  const checkAbort = () => {
    if (opts.signal?.aborted) {
      const err: any = new Error('cancelled');
      err.code = 'CANCELLED';
      throw err;
    }
  };

  checkAbort();
  opts.onProgress?.(10);
  await yieldTick();

  const budget = enforceComputeBudget({ graph, requested_k: k_samples, soft_cap_k: 5000, max_compute_ms: 30000 });
  const identifiability = checkIdentifiability({ graph, treatment_node, outcome_node });
  const model_card = buildModelCard({
    seed,
    assumptions: [
      'Linear response within ±20% of baseline',
      'Independent observations',
      identifiability.summary,
    ],
    k_samples: budget.k,
    downgraded: budget.downgraded,
    downgrade_reason: budget.reason,
    feature_flags: getActiveFeatureFlags(),
  });

  if (process.env.IDENT_TAG_ENABLE === '1') {
    const { generateIdentifiabilityTag } = await import('../trust/identifiability-tag.js');
    model_card.identifiability_tag = generateIdentifiabilityTag({
      identifiable: identifiability.identifiable,
      has_backdoor_paths: identifiability.adjustment_set.length > 0,
      adjustment_set_size: identifiability.adjustment_set.length,
    });
  }

  checkAbort();
  opts.onProgress?.(40);
  await yieldTick();

  const current_value = baseline_value * 1.15;
  const linearity_warning = checkLinearity({ baseline_value, current_value, linear_range_percent: 20 });

  let confidence = calculateConfidence({
    graph,
    identifiable: identifiability.identifiable,
    in_linear_range: !linearity_warning.outside_range,
    k_samples: budget.k,
    calibrated: false,
  });

  const threshold_crossings = detectThresholdCrossings({
    metric_name: 'outcome',
    from_value: baseline_value,
    to_value: current_value,
    thresholds: [99, 199, 299],
  });
  const fork_suggestions = threshold_crossings.length > 0
    ? generateForkSuggestions({
        metric_name: 'outcome',
        current_value,
        threshold: threshold_crossings[0].threshold,
        direction: threshold_crossings[0].direction,
      })
    : undefined;

  const critique = buildCritique({
    graph,
    assumptions: model_card.assumptions_summary,
    identifiable: identifiability.identifiable,
    node_limit: 12,
  });

  checkAbort();
  opts.onProgress?.(70);
  await yieldTick();

  const explain_delta = buildExplainDelta({
    graph,
    baseline_outcome: baseline_value,
    counterfactual_outcome: current_value,
    seed,
    top_n: 3,
  });

  let results: any;
  let scm_bma_hash: string | undefined;
  if (process.env.SCM_LITE_ENABLE === '1') {
    const { runSCMLite } = await import('../scm-lite/adapter.js');
    const scmConfig = {
      seed,
      K: Number(process.env.SCM_LITE_K || 256),
      maxNodes: Number(process.env.SCM_LITE_MAX_NODES || 12),
      maxEdges: Number(process.env.SCM_LITE_MAX_EDGES || 20),
      beliefDefault: Number(process.env.SCM_LITE_BELIEF_DEFAULT || 0.7),
    };
    const scmResult: any = runSCMLite(graph, outcome_node, scmConfig);
    results = {
      conservative: { outcome: scmResult.summary.bands.p10 },
      most_likely: { outcome: scmResult.summary.bands.p50 },
      optimistic: { outcome: scmResult.summary.bands.p90 },
    };
    scm_bma_hash = scmResult.bma_hash;
    const scmLevelMap: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 };
    confidence = {
      level: scmResult.confidence.toUpperCase() as any,
      reason: `SCM-Lite kernel (K=${scmConfig.K}, unique_graphs=${scmResult.meta.unique_graphs})`,
      score: scmLevelMap[scmResult.confidence] || 0.5,
      factors: {
        identifiability: identifiability.identifiable ? 1.0 : 0.3,
        linearity_distance: 1.0,
        k_coverage: Math.min(scmConfig.K / 1000, 1.0),
        calibration: scmResult.meta.sign_stability,
      },
    } as any;
  } else {
    results = {
      conservative: { outcome: baseline_value * 1.05 },
      most_likely: { outcome: current_value },
      optimistic: { outcome: baseline_value * 1.25 },
    };
  }

  const base: any = {
    confidence,
    critique,
    explain_delta,
    graph,
    identifiability: identifiability.summary,
    meta: {
      seed,
      commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
      version: '1.0.0',
    },
    model_card,
    results,
    schema: 'run.v1',
  };
  const normalised = normaliseReport(base);
  const canonical = stableStringify(normalised);
  const response_hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  base.model_card.response_hash = response_hash;
  if (scm_bma_hash) base.model_card.bma_hash = scm_bma_hash;
  if (process.env.TRACE_MIN === '1') base.trace_id = randomUUID();

  await yieldTick();
  opts.onInterim?.({
    top_signals: (base?.explain_delta?.top_changes || base?.explain_delta?.top || []).slice(0, 3) || [],
    partial_confidence: base?.confidence?.score ?? null,
  });

  opts.onProgress?.(100);

  const computeMs = performance.now() - start;
  return { report: base, computeMs };
}
