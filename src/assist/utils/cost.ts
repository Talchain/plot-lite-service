/**
 * Cost calculation and COST_MAX_USD guard for LLM calls.
 * Provider-specific pricing per v04 spec.
 */

/**
 * Usage metrics for cost calculation
 */
export interface UsageMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Pricing tables (USD per 1K tokens)
 */
const OPENAI_PRICING: Record<string, { input_per_1k: number; output_per_1k: number }> = {
  'gpt-4o-mini': {
    input_per_1k: 0.00015,  // $0.15 per 1M
    output_per_1k: 0.0006,  // $0.60 per 1M
  },
  'gpt-4o': {
    input_per_1k: 0.0025,  // $2.50 per 1M
    output_per_1k: 0.01,   // $10.00 per 1M
  },
};

const ANTHROPIC_PRICING: Record<string, { input_per_1k: number; output_per_1k: number }> = {
  'claude-3-haiku-20240307': {
    input_per_1k: 0.00025,  // $0.25 per 1M
    output_per_1k: 0.00125, // $1.25 per 1M
  },
  'claude-3-5-sonnet-20241022': {
    input_per_1k: 0.003,    // $3.00 per 1M
    output_per_1k: 0.015,   // $15.00 per 1M
  },
};

/**
 * Calculate cost for OpenAI usage
 */
export function calculateOpenAICost(model: string, usage: UsageMetrics): number {
  const pricing = OPENAI_PRICING[model];
  if (!pricing) {
    console.warn(`[COST] Unknown OpenAI model: ${model}, using gpt-4o-mini pricing`);
    return calculateOpenAICost('gpt-4o-mini', usage);
  }

  const inputCost = (usage.input_tokens / 1000) * pricing.input_per_1k;
  const outputCost = (usage.output_tokens / 1000) * pricing.output_per_1k;

  return inputCost + outputCost;
}

/**
 * Calculate cost for Anthropic usage
 */
export function calculateAnthropicCost(model: string, usage: UsageMetrics): number {
  const pricing = ANTHROPIC_PRICING[model];
  if (!pricing) {
    console.warn(`[COST] Unknown Anthropic model: ${model}, using claude-3-haiku pricing`);
    return calculateAnthropicCost('claude-3-haiku-20240307', usage);
  }

  const inputCost = (usage.input_tokens / 1000) * pricing.input_per_1k;
  const outputCost = (usage.output_tokens / 1000) * pricing.output_per_1k;

  // Anthropic cache savings (if applicable)
  const cacheSavings = usage.cache_read_input_tokens
    ? (usage.cache_read_input_tokens / 1000) * pricing.input_per_1k * 0.9  // 90% discount
    : 0;

  return inputCost + outputCost - cacheSavings;
}

/**
 * Calculate cost for any provider
 */
export function calculateCost(provider: string, model: string, usage: UsageMetrics): number {
  if (provider === 'openai') {
    return calculateOpenAICost(model, usage);
  } else if (provider === 'anthropic') {
    return calculateAnthropicCost(model, usage);
  } else {
    return 0;  // Fixtures have zero cost
  }
}

/**
 * Check if cost exceeds max allowed (COST_MAX_USD guard)
 */
export function exceedsCostCap(cost: number, maxUsd: number): boolean {
  return cost > maxUsd;
}

/**
 * Get cost cap from environment (default 1.00 USD)
 */
export function getCostCap(): number {
  const cap = Number(process.env.COST_MAX_USD);
  return isNaN(cap) || cap <= 0 ? 1.0 : cap;
}
