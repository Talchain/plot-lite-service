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
import type { UpstreamGraph, EngineGraphV3 } from '../types/engine-v3.js';

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
