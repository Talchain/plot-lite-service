/**
 * Ajv schema for provenance validation
 * Flag: PROVENANCE_ENABLE=1
 */

export interface EdgeWithProvenance {
  from: string;
  to: string;
  weight?: number;
  belief?: number;
  provenance_note?: string;
}

export function validateProvenance(edges: any[]): { valid: boolean; errors?: string[] } {
  if (!Array.isArray(edges)) {
    return { valid: false, errors: ['edges must be an array'] };
  }

  const errors: string[] = [];
  
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.provenance_note !== undefined && edge.provenance_note !== null) {
      if (typeof edge.provenance_note !== 'string') {
        errors.push(`edges[${i}].provenance_note must be a string`);
      } else if (edge.provenance_note.length > 200) {
        errors.push(`edges[${i}].provenance_note exceeds 200 characters`);
      } else if (!/^[a-zA-Z0-9 .,;:!?()'"-]+$/.test(edge.provenance_note)) {
        errors.push(`edges[${i}].provenance_note contains invalid characters`);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
