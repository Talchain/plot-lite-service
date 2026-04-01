/**
 * Shared Graph Normaliser — Single entry point for pre-ISL normalisation.
 *
 * Both `/v2/run` and `/v1/validate-patch` MUST call `normaliseGraphWithRepairs()`
 * to ensure normalisation parity. This guarantees:
 *   - Same graph → identical normalised output and repairs_applied[]
 *   - All repairs use canonical codes from repair-codes.ts
 *   - Deterministic ordering of repairs and graph elements
 *
 * @see repair-codes.ts for the canonical repair code enum (SSOT)
 */

import { normaliseGraph, NormalisationError, type NormalisationWarning, type NormalisationResult } from './graph-normaliser.js';
import type { RepairEntry, RepairCode, RepairAction } from './repair-codes.js';
import { REPAIR_CODES } from './repair-codes.js';
import type { UpstreamGraph, EngineGraphV3, EngineEdgeV3 } from '../types/engine-v3.js';

// Re-export for convenience
export { NormalisationError } from './graph-normaliser.js';
export type { RepairEntry } from './repair-codes.js';
export { REPAIR_CODES } from './repair-codes.js';

// -----------------------------------------------------------------------------
// Result Type
// -----------------------------------------------------------------------------

export interface NormaliseAndRepairResult {
  /** Normalised graph in canonical EngineGraphV3 format */
  graph: EngineGraphV3;
  /** Canonical repair entries for all modifications made */
  repairs: RepairEntry[];
  /** Informational warnings (non-repair, e.g., option node notices) */
  warnings: NormalisationWarning[];
  /** Count of normalised nodes */
  nodesNormalised: number;
  /** Count of normalised edges */
  edgesNormalised: number;
}

// -----------------------------------------------------------------------------
// Warning → RepairEntry Mapping
// -----------------------------------------------------------------------------

/**
 * Map a NormalisationWarning severity to a RepairEntry severity.
 * Warnings that clamp or change user-visible values are 'warn';
 * defaults and derivations are 'info'.
 */
function repairSeverity(action: string): 'info' | 'warn' {
  if (action === 'clamped' || action === 'normalised') return 'warn';
  return 'info';
}

/**
 * Convert a NormalisationWarning (with repair data) to a canonical RepairEntry.
 */
function warningToRepair(w: NormalisationWarning & { repair: NonNullable<NormalisationWarning['repair']> }): RepairEntry {
  // Build the field_path from the warning's entity context + repair field
  const entityPrefix = w.edge_id ? `${w.edge_id}.` : w.node_id ? `${w.node_id}.` : '';
  const fieldPath = `${entityPrefix}${w.repair.field.replace(/^(edge|node)\./, '')}`;

  return {
    code: w.code as RepairCode,
    layer: 'plot',
    field_path: fieldPath,
    before: w.repair.from_value,
    after: w.repair.to_value,
    reason: w.repair.reason,
    severity: repairSeverity(w.repair.action),
    action: w.repair.action as RepairAction,
  };
}

// -----------------------------------------------------------------------------
// Forbidden-Edge Rerouting
// -----------------------------------------------------------------------------

/**
 * Reroute forbidden edges deterministically, before the LLM repair pass.
 *
 * Handles two patterns:
 *   1. outcome→outcome or outcome→risk: reroute via factor parents of the source outcome
 *   2. risk→outcome: reroute via factor parents of the source risk
 *
 * For each forbidden edge:
 *   - Find all factor nodes with an outbound edge into the source node
 *   - For each such factor parent, add an attenuated causal edge to the target (if not already present)
 *   - Remove the forbidden edge
 *   - Log a RepairEntry for each rerouted edge
 *
 * If no factor parents exist the forbidden edge is left in place and logged as
 * UNRESOLVABLE_FORBIDDEN_EDGE so the downstream LLM repair pass can handle it.
 *
 * @param graph  Normalised EngineGraphV3 (mutated in place)
 * @returns      Array of RepairEntry records for all reroutes performed
 */
function rerouteForbiddenEdges(graph: EngineGraphV3): RepairEntry[] {
  const repairs: RepairEntry[] = [];

  // Build a node-kind lookup
  const nodeKind = new Map<string, string>();
  for (const node of graph.nodes) {
    nodeKind.set(node.id, node.kind as string);
  }

  // Build an edge-presence set for duplicate-edge guard
  // Key: "from::to"
  function edgeKey(from: string, to: string): string {
    return `${from}::${to}`;
  }
  const edgeSet = new Set<string>(graph.edges.map(e => edgeKey(e.from, e.to)));

  // Indices to remove (processed after iteration)
  const indicesToRemove = new Set<number>();

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const srcKind = nodeKind.get(edge.from);
    const tgtKind = nodeKind.get(edge.to);

    // Determine which pattern applies
    let repairCode: typeof REPAIR_CODES.REROUTE_OUTCOME_CHAIN | typeof REPAIR_CODES.REROUTE_RISK_TO_OUTCOME | null = null;
    let repairReason = '';

    if (srcKind === 'outcome' && (tgtKind === 'outcome' || tgtKind === 'risk')) {
      repairCode = REPAIR_CODES.REROUTE_OUTCOME_CHAIN;
      repairReason = `Removed forbidden outcome→${tgtKind} edge; rerouted via shared factor parent`;
    } else if (srcKind === 'risk' && tgtKind === 'outcome') {
      repairCode = REPAIR_CODES.REROUTE_RISK_TO_OUTCOME;
      repairReason = `Removed forbidden risk→outcome edge; rerouted via shared factor parent`;
    }

    if (repairCode === null) continue;

    // Find factor parents of the source node
    const factorParents = graph.edges.filter(
      e => e.to === edge.from && nodeKind.get(e.from) === 'factor'
    );

    if (factorParents.length === 0) {
      // Cannot reroute — leave the edge and log as unresolvable
      repairs.push({
        code: REPAIR_CODES.UNRESOLVABLE_FORBIDDEN_EDGE,
        layer: 'plot',
        field_path: `edges[${i}]`,
        before: { from: edge.from, to: edge.to },
        after: null,
        reason: `Forbidden ${srcKind}→${tgtKind} edge has no factor parents; left for LLM repair`,
        severity: 'warn',
        action: 'removed',
      });
      continue;
    }

    // Remove the forbidden edge
    indicesToRemove.add(i);
    edgeSet.delete(edgeKey(edge.from, edge.to));

    // Add attenuated edges from each factor parent to the target
    for (const parentEdge of factorParents) {
      const newKey = edgeKey(parentEdge.from, edge.to);
      if (edgeSet.has(newKey)) {
        // Edge already exists — skip, no duplicate
        continue;
      }

      const newEdge: EngineEdgeV3 = {
        from: parentEdge.from,
        to: edge.to,
        exists_probability: edge.exists_probability * 0.8,
        strength: {
          mean: edge.strength.mean * 0.5,
          std: Math.max(edge.strength.std, 0.15),
        },
      };

      graph.edges.push(newEdge);
      edgeSet.add(newKey);

      repairs.push({
        code: repairCode,
        layer: 'plot',
        field_path: `edges[${i}]`,
        before: { from: edge.from, to: edge.to },
        after: { from: parentEdge.from, to: edge.to, attenuated: true },
        reason: repairReason,
        severity: 'warn',
        action: 'removed',
      });
    }
  }

  // Remove forbidden edges in reverse index order to preserve positions
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    graph.edges.splice(idx, 1);
  }

  return repairs;
}

// -----------------------------------------------------------------------------
// Shared Normaliser
// -----------------------------------------------------------------------------

/**
 * Normalise an upstream graph and produce canonical RepairEntry records.
 *
 * This is the SINGLE entry point for pre-ISL normalisation. Both
 * `/v2/run` and `/v1/validate-patch` call this function to ensure
 * normalisation parity.
 *
 * @param upstreamGraph Graph in any supported upstream format
 * @returns Normalised graph, canonical repairs, and informational warnings
 * @throws NormalisationError if the graph is structurally invalid
 */
export function normaliseGraphWithRepairs(upstreamGraph: UpstreamGraph): NormaliseAndRepairResult {
  const result: NormalisationResult = normaliseGraph(upstreamGraph);

  // Partition warnings: those with repair data become RepairEntry objects,
  // the rest remain as informational warnings.
  const repairs: RepairEntry[] = [];
  const infoWarnings: NormalisationWarning[] = [];

  for (const w of result.warnings) {
    if (w.repair !== undefined) {
      repairs.push(warningToRepair(
        w as NormalisationWarning & { repair: NonNullable<NormalisationWarning['repair']> }
      ));
    } else {
      infoWarnings.push(w);
    }
  }

  // Reroute forbidden edges deterministically (outcome→outcome, outcome→risk, risk→outcome).
  // Mutates result.graph in place; appends RepairEntry records.
  const rerouteRepairs = rerouteForbiddenEdges(result.graph);
  repairs.push(...rerouteRepairs);

  // Deterministic ordering: stable-sort repairs by code then field_path.
  // This ensures identical graphs produce identical repair lists.
  repairs.sort((a, b) =>
    a.code.localeCompare(b.code) || a.field_path.localeCompare(b.field_path)
  );

  return {
    graph: result.graph,
    repairs,
    warnings: infoWarnings,
    nodesNormalised: result.nodesNormalised,
    edgesNormalised: result.edgesNormalised,
  };
}
