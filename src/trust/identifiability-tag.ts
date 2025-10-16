/**
 * Identifiability Tag - Plain English summary
 * Flag: IDENT_TAG_ENABLE=1
 */

export interface IdentifiabilityTagInput {
  identifiable: boolean;
  has_backdoor_paths: boolean;
  adjustment_set_size: number;
}

export function generateIdentifiabilityTag(input: IdentifiabilityTagInput): string {
  const { identifiable, has_backdoor_paths, adjustment_set_size } = input;

  if (identifiable) {
    if (adjustment_set_size === 0) {
      return 'Decision-ready: Clean causal path, no confounders';
    } else if (adjustment_set_size <= 2) {
      return `Decision-ready: Identifiable with ${adjustment_set_size} adjustment${adjustment_set_size > 1 ? 's' : ''}`;
    } else {
      return `Decision-ready: Identifiable but requires ${adjustment_set_size} adjustments`;
    }
  } else {
    if (has_backdoor_paths) {
      return 'Exploratory: Unblocked backdoor paths detected';
    } else {
      return 'Exploratory: No causal path found';
    }
  }
}
