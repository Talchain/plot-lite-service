/**
 * Evidence Validation Utility
 * 
 * Validates evidence annotations for audit trail
 */

export interface EvidenceItem {
  node_id: string;
  source: string;
  note?: string;
  weight?: number;
}

export interface EvidenceValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

/**
 * Validate evidence array
 * @param evidence - Evidence items to validate
 * @param nodeIds - Optional set of valid node IDs to check against
 * @returns Validation result with any errors
 */
export function validateEvidence(
  evidence: any,
  nodeIds?: Set<string>
): EvidenceValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  
  // Must be an array
  if (!Array.isArray(evidence)) {
    errors.push({
      field: 'evidence',
      message: 'evidence must be an array'
    });
    return { valid: false, errors };
  }
  
  // Validate each item
  for (let i = 0; i < evidence.length; i++) {
    const item = evidence[i];
    const prefix = `evidence[${i}]`;
    
    // Must be an object
    if (typeof item !== 'object' || item === null) {
      errors.push({
        field: prefix,
        message: 'Evidence item must be an object'
      });
      continue;
    }
    
    // node_id required and must be string
    if (typeof item.node_id !== 'string' || item.node_id.trim() === '') {
      errors.push({
        field: `${prefix}.node_id`,
        message: 'node_id is required and must be a non-empty string'
      });
    } else if (nodeIds && !nodeIds.has(item.node_id)) {
      errors.push({
        field: `${prefix}.node_id`,
        message: `Evidence references unknown node: ${item.node_id}`
      });
    }
    
    // source required and must be string
    if (typeof item.source !== 'string' || item.source.trim() === '') {
      errors.push({
        field: `${prefix}.source`,
        message: 'source is required and must be a non-empty string'
      });
    } else if (item.source.length > 200) {
      errors.push({
        field: `${prefix}.source`,
        message: 'source must be ≤200 characters'
      });
    }
    
    // note optional but must be string if present
    if (item.note !== undefined) {
      if (typeof item.note !== 'string') {
        errors.push({
          field: `${prefix}.note`,
          message: 'note must be a string'
        });
      } else if (item.note.length > 500) {
        errors.push({
          field: `${prefix}.note`,
          message: 'note must be ≤500 characters'
        });
      }
    }
    
    // weight optional but must be number 0-1 if present
    if (item.weight !== undefined) {
      if (typeof item.weight !== 'number' || isNaN(item.weight) || !isFinite(item.weight)) {
        errors.push({
          field: `${prefix}.weight`,
          message: 'weight must be a finite number'
        });
      } else if (item.weight < 0 || item.weight > 1) {
        errors.push({
          field: `${prefix}.weight`,
          message: 'weight must be between 0 and 1'
        });
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize evidence for response metadata (remove sensitive notes)
 * @param evidence - Evidence items to sanitize
 * @returns Sanitized evidence array safe for response
 */
export function sanitizeEvidence(evidence: EvidenceItem[]): Array<{
  node_id: string;
  source: string;
  weight?: number;
}> {
  return evidence.map(item => ({
    node_id: item.node_id,
    source: item.source,
    ...(item.weight !== undefined && { weight: item.weight })
  }));
}

/**
 * Count evidence items
 */
export function countEvidence(evidence: EvidenceItem[] | undefined): number {
  return evidence?.length ?? 0;
}
