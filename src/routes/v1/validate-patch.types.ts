/**
 * /v1/validate-patch Request/Response Types
 *
 * Applies sequential patch operations to a graph and validates the result.
 */

import type { EngineNodeV3, EngineEdgeV3 } from '../../types/engine-v3.js';

// =============================================================================
// Request Types
// =============================================================================

export interface ValidatePatchRequest {
  graph: { nodes: EngineNodeV3[]; edges: EngineEdgeV3[] };
  operations: PatchOperation[];
  request_id?: string;
}

export type PatchOperationType =
  | 'add_node'
  | 'add_edge'
  | 'remove_node'
  | 'remove_edge'
  | 'update_node'
  | 'update_edge';

export interface PatchOperation {
  /** Operation type */
  op: PatchOperationType;
  /** Entity ID: node ID for node ops, edge key (from->to) for edge ops. NOT a JSON pointer. */
  path: string;
  /** Value to add or merge (for add/update operations) */
  value?: Partial<EngineNodeV3 | EngineEdgeV3>;
  /** Previous value for undo support */
  previous?: Partial<EngineNodeV3 | EngineEdgeV3>;
}

// =============================================================================
// Response Types
// =============================================================================

export interface ValidatePatchResponse {
  status: 'applied';
  graph: { nodes: EngineNodeV3[]; edges: EngineEdgeV3[] };
  graph_hash: string;
  repairs_applied: RepairEntry[];
  warnings: ValidationWarning[];
}

export interface ValidatePatchRejection {
  status: 'rejected';
  code: string;
  message: string;
  violations?: ViolationV3[];
}

export interface ValidationWarning {
  code: string;
  message: string;
  field_path: string;
}

export interface RepairEntry {
  code: string;
  layer: 'plot';
  field_path: string;
  before: unknown;
  after: unknown;
  reason: string;
  severity: 'info' | 'warn';
}

export interface ViolationV3 {
  code: string;
  message: string;
  node_id?: string;
  edge_id?: string;
}
