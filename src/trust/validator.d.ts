/**
 * Type declarations for validator.js
 */

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateGraph(graph: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> }): ValidationResult;
