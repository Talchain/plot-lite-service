/**
 * Priors validation utilities
 * Validates node priors for belief initialization
 */

export type PriorValue = number | { mean: number; sd: number };

export interface PriorsValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

/**
 * Validate priors object
 * Accepts: Record<node_id, number | {mean, sd}>
 * Range checks: 0 <= value <= 1 for numbers, sd > 0 for distributions
 */
export function validatePriors(
  priors: Record<string, PriorValue> | undefined,
  nodeIds?: Set<string>
): PriorsValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  
  if (!priors) {
    return { valid: true, errors: [] };
  }
  
  if (typeof priors !== 'object' || Array.isArray(priors)) {
    errors.push({
      field: 'priors',
      message: 'priors must be an object mapping node_id to number or {mean, sd}'
    });
    return { valid: false, errors };
  }
  
  for (const [nodeId, value] of Object.entries(priors)) {
    // Check if node exists (if nodeIds provided)
    if (nodeIds && !nodeIds.has(nodeId)) {
      errors.push({
        field: `priors.${nodeId}`,
        message: `Prior specified for unknown node: ${nodeId}`
      });
      continue;
    }
    
    // Validate value type and range
    if (typeof value === 'number') {
      if (isNaN(value) || !isFinite(value)) {
        errors.push({
          field: `priors.${nodeId}`,
          message: 'Prior value must be a finite number'
        });
      } else if (value < 0 || value > 1) {
        errors.push({
          field: `priors.${nodeId}`,
          message: 'Prior value must be between 0 and 1'
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      // Distribution format: {mean, sd}
      const dist = value as { mean?: any; sd?: any };
      
      if (typeof dist.mean !== 'number') {
        errors.push({
          field: `priors.${nodeId}.mean`,
          message: 'Prior distribution mean must be a number'
        });
      } else if (dist.mean < 0 || dist.mean > 1) {
        errors.push({
          field: `priors.${nodeId}.mean`,
          message: 'Prior distribution mean must be between 0 and 1'
        });
      }
      
      if (typeof dist.sd !== 'number') {
        errors.push({
          field: `priors.${nodeId}.sd`,
          message: 'Prior distribution sd must be a number'
        });
      } else if (dist.sd <= 0) {
        errors.push({
          field: `priors.${nodeId}.sd`,
          message: 'Prior distribution sd must be greater than 0'
        });
      }
    } else {
      errors.push({
        field: `priors.${nodeId}`,
        message: 'Prior must be a number or {mean, sd} object'
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Count priors for logging
 */
export function countPriors(priors: Record<string, PriorValue> | undefined): number {
  if (!priors || typeof priors !== 'object') return 0;
  return Object.keys(priors).length;
}
