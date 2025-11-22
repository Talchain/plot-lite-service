import type { Priors, Evidence, ValidationResult, ValidationError } from './types.js';

export function validatePriors(priors: Priors, nodeIds: Set<string>): ValidationResult {
  const errors: ValidationError[] = [];

  for (const [nodeId, prior] of Object.entries(priors)) {
    // Check node exists
    if (!nodeIds.has(nodeId)) {
      errors.push({
        field: `priors.${nodeId}`,
        message: `Prior references unknown node: ${nodeId}`
      });
      continue;
    }

    // Validate number format
    if (typeof prior === 'number') {
      if (!Number.isFinite(prior)) {
        errors.push({
          field: `priors.${nodeId}`,
          message: 'Prior value must be finite'
        });
      } else if (prior < 0 || prior > 1) {
        errors.push({
          field: `priors.${nodeId}`,
          message: 'Prior value must be between 0 and 1'
        });
      }
    }
    // Validate distribution format
    else if (typeof prior === 'object' && prior !== null) {
      if (typeof prior.mean !== 'number' || typeof prior.sd !== 'number') {
        errors.push({
          field: `priors.${nodeId}`,
          message: 'Prior distribution must have numeric mean and sd'
        });
      } else {
        if (!Number.isFinite(prior.mean) || !Number.isFinite(prior.sd)) {
          errors.push({
            field: `priors.${nodeId}`,
            message: 'Prior mean and sd must be finite'
          });
        }
        if (prior.mean < 0 || prior.mean > 1) {
          errors.push({
            field: `priors.${nodeId}.mean`,
            message: 'Prior mean must be between 0 and 1'
          });
        }
        if (prior.sd <= 0) {
          errors.push({
            field: `priors.${nodeId}.sd`,
            message: 'Prior sd must be > 0'
          });
        }
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

export function validateEvidence(evidence: Evidence[], nodeIds: Set<string>): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(evidence)) {
    errors.push({
      field: 'evidence',
      message: 'Evidence must be an array'
    });
    return { valid: false, errors };
  }

  for (let i = 0; i < evidence.length; i++) {
    const item = evidence[i];

    // Check required fields
    if (!item.node_id || typeof item.node_id !== 'string') {
      errors.push({
        field: `evidence[${i}].node_id`,
        message: 'node_id is required and must be a string'
      });
    } else if (!nodeIds.has(item.node_id)) {
      errors.push({
        field: `evidence[${i}].node_id`,
        message: `Evidence references unknown node: ${item.node_id}`
      });
    }

    if (!item.source || typeof item.source !== 'string') {
      errors.push({
        field: `evidence[${i}].source`,
        message: 'source is required and must be a non-empty string'
      });
    } else if (item.source.length > 200) {
      errors.push({
        field: `evidence[${i}].source`,
        message: 'source must be ≤200 characters'
      });
    }

    // Check optional fields
    if (item.note !== undefined) {
      if (typeof item.note !== 'string') {
        errors.push({
          field: `evidence[${i}].note`,
          message: 'note must be a string'
        });
      } else if (item.note.length > 500) {
        errors.push({
          field: `evidence[${i}].note`,
          message: 'note must be ≤500 characters'
        });
      }
    }

    if (item.weight !== undefined) {
      if (typeof item.weight !== 'number' || !Number.isFinite(item.weight)) {
        errors.push({
          field: `evidence[${i}].weight`,
          message: 'weight must be a finite number'
        });
      } else if (item.weight < 0 || item.weight > 1) {
        errors.push({
          field: `evidence[${i}].weight`,
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

export function validateTimeslices(timeslices: string[]): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(timeslices)) {
    errors.push({
      field: 'timeslices',
      message: 'timeslices must be an array'
    });
    return { valid: false, errors };
  }

  if (timeslices.length === 0) {
    errors.push({
      field: 'timeslices',
      message: 'timeslices must not be empty'
    });
  }

  if (timeslices.length > 12) {
    errors.push({
      field: 'timeslices',
      message: 'Maximum 12 timeslices allowed'
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
