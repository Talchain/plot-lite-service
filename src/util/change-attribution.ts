/**
 * Change Attribution Builder
 *
 * Maps structural graph differences to estimated causal impact on outcomes.
 * Uses simplified heuristics for PoC; can be enhanced with more sophisticated
 * causal inference in future iterations.
 */

import type { GraphDiffResult } from './graph-diff.js';
import type {
  ChangeAttribution,
  ChangeDriver,
  AffectedNode,
} from '../types/change-attribution.js';
import type { GraphNode } from '../trust/types.js';

/** Graph edge for impact estimation */
interface GraphEdge {
  from: string;
  to: string;
  weight?: number;
  id?: string;
}

/** Scenario run results for comparison */
export interface ScenarioRun {
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  outcome_value: number;
}

/**
 * Build change attribution by mapping structural diffs to causal impact.
 *
 * Uses simplified heuristics:
 * - Edge impact: weight × from_value × to_value
 * - Weight change impact: weight_delta × from_value × to_value
 * - Node value impact: value_delta
 *
 * @param baseline - Baseline scenario results.
 * @param comparison - Comparison scenario results.
 * @param diff - Structural diff between graphs.
 * @returns Change attribution with top drivers.
 */
export function buildChangeAttribution(
  baseline: ScenarioRun,
  comparison: ScenarioRun,
  diff: GraphDiffResult
): ChangeAttribution {
  const drivers: ChangeDriver[] = [];
  const outcome_delta = comparison.outcome_value - baseline.outcome_value;

  // Process edge removals
  for (const edge of diff.edges_removed) {
    const fromNode = baseline.graph.nodes.find((n) => n.id === edge.from);
    const toNode = baseline.graph.nodes.find((n) => n.id === edge.to);

    if (fromNode && toNode) {
      const contribution = estimateEdgeImpact(edge, baseline, 'removed');

      drivers.push({
        change_type: 'edge_removed',
        description: `Removed ${fromNode.label} → ${toNode.label}`,
        contribution_to_delta: contribution,
        contribution_pct: 0, // Will calculate after all drivers collected
        affected_nodes: [
          { id: edge.from, label: fromNode.label },
          { id: edge.to, label: toNode.label },
        ],
      });
    }
  }

  // Process edge additions
  for (const edge of diff.edges_added) {
    const fromNode = comparison.graph.nodes.find((n) => n.id === edge.from);
    const toNode = comparison.graph.nodes.find((n) => n.id === edge.to);

    if (fromNode && toNode) {
      const contribution = estimateEdgeImpact(edge, comparison, 'added');

      drivers.push({
        change_type: 'edge_added',
        description: `Added ${fromNode.label} → ${toNode.label}`,
        contribution_to_delta: contribution,
        contribution_pct: 0,
        affected_nodes: [
          { id: edge.from, label: fromNode.label },
          { id: edge.to, label: toNode.label },
        ],
      });
    }
  }

  // Process edge weight changes
  for (const edgeChange of diff.edges_modified) {
    const weightChange = edgeChange.changes.find((c) => c.field === 'weight');
    if (
      !weightChange ||
      weightChange.old_value === undefined ||
      weightChange.new_value === undefined
    ) {
      continue;
    }

    const edge = edgeChange.edge;
    const fromNode = comparison.graph.nodes.find((n) => n.id === edge.from);
    const toNode = comparison.graph.nodes.find((n) => n.id === edge.to);

    if (fromNode && toNode) {
      const contribution = estimateWeightChangeImpact(
        edge,
        weightChange.old_value as number,
        weightChange.new_value as number,
        comparison
      );

      const beforeVal = (weightChange.old_value as number).toFixed(2);
      const afterVal = (weightChange.new_value as number).toFixed(2);

      drivers.push({
        change_type: 'edge_weight_changed',
        description: `Changed ${fromNode.label} → ${toNode.label} weight (${beforeVal} → ${afterVal})`,
        contribution_to_delta: contribution,
        contribution_pct: 0,
        before_value: weightChange.old_value as number,
        after_value: weightChange.new_value as number,
        affected_nodes: [
          { id: fromNode.id, label: fromNode.label },
          { id: toNode.id, label: toNode.label },
        ],
      });
    }
  }

  // Process node value changes
  for (const nodeChange of diff.nodes_modified) {
    const valueChange = nodeChange.changes.find((c) => c.field === 'value');
    if (
      !valueChange ||
      valueChange.old_value === undefined ||
      valueChange.new_value === undefined
    ) {
      continue;
    }

    const nodeData = comparison.graph.nodes.find(
      (n) => n.id === nodeChange.node.id
    );
    if (!nodeData) continue;

    const contribution =
      (valueChange.new_value as number) - (valueChange.old_value as number);

    const beforeVal = (valueChange.old_value as number).toFixed(2);
    const afterVal = (valueChange.new_value as number).toFixed(2);

    drivers.push({
      change_type: 'node_value_changed',
      description: `Changed ${nodeData.label} value (${beforeVal} → ${afterVal})`,
      contribution_to_delta: contribution,
      contribution_pct: 0,
      before_value: valueChange.old_value as number,
      after_value: valueChange.new_value as number,
      affected_nodes: [{ id: nodeData.id, label: nodeData.label }],
    });
  }

  // Sort by absolute contribution (largest impact first)
  drivers.sort(
    (a, b) =>
      Math.abs(b.contribution_to_delta) - Math.abs(a.contribution_to_delta)
  );

  // Calculate percentages based on absolute values
  const totalAbsContribution = drivers.reduce(
    (sum, d) => sum + Math.abs(d.contribution_to_delta),
    0
  );

  for (const driver of drivers) {
    if (totalAbsContribution > 0) {
      driver.contribution_pct = Math.round(
        (Math.abs(driver.contribution_to_delta) / totalAbsContribution) * 100
      );
    }
  }

  // Take top 5 drivers for primary_drivers
  const primary_drivers = drivers.slice(0, 5);

  // Generate human-readable summary
  const summary = generateSummary(primary_drivers, outcome_delta);

  return {
    outcome_delta: Math.round(outcome_delta * 1000) / 1000,
    primary_drivers,
    summary,
  };
}

/**
 * Estimate causal impact of edge removal/addition
 *
 * Simplified heuristic: weight × product of connected node values
 * More sophisticated methods (e.g., structural equations) can be added later
 */
function estimateEdgeImpact(
  edge: GraphEdge,
  scenario: ScenarioRun,
  changeType: 'added' | 'removed'
): number {
  const fromNode = scenario.graph.nodes.find((n) => n.id === edge.from);
  const toNode = scenario.graph.nodes.find((n) => n.id === edge.to);

  if (!fromNode || !toNode) return 0;

  const fromValue = fromNode.value ?? 0.5;
  const toValue = toNode.value ?? 0.5;
  const weight = edge.weight ?? 0.5;

  // Simple heuristic: impact = weight × from_value × to_value
  const impact = weight * fromValue * toValue;

  // Negative for removals, positive for additions
  return changeType === 'removed' ? -impact : impact;
}

/**
 * Estimate causal impact of weight change
 *
 * Impact proportional to weight change magnitude and node values
 */
function estimateWeightChangeImpact(
  edge: GraphEdge,
  beforeWeight: number,
  afterWeight: number,
  scenario: ScenarioRun
): number {
  const fromNode = scenario.graph.nodes.find((n) => n.id === edge.from);
  const toNode = scenario.graph.nodes.find((n) => n.id === edge.to);

  if (!fromNode || !toNode) return 0;

  const fromValue = fromNode.value ?? 0.5;
  const toValue = toNode.value ?? 0.5;

  // Impact proportional to weight change magnitude
  const weightDelta = afterWeight - beforeWeight;
  return weightDelta * fromValue * toValue;
}

/**
 * Generate human-readable summary of attribution
 */
function generateSummary(drivers: ChangeDriver[], delta: number): string {
  if (drivers.length === 0) {
    return delta > 0
      ? 'Outcome increased with no clear structural drivers'
      : delta < 0
        ? 'Outcome decreased with no clear structural drivers'
        : 'No significant outcome change detected';
  }

  const topDriver = drivers[0];
  const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'change';
  const changeDesc =
    topDriver.description.charAt(0).toLowerCase() +
    topDriver.description.slice(1);

  return `${topDriver.contribution_pct}% of ${direction} from ${changeDesc}`;
}
