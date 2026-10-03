// =============================================================================
// SCIENCE ROBUSTNESS (EXPERIMENT; SCIENCE/DSK, programme-docs #85; DL ruling 5948081549 condition 5).
//
// "What would change this?" — on demand only. When a /v2/run body carries `decision_flip`, PLoT builds the ISL request
// exactly as for a Run and asks ISL for the recommendation's tipping point per link instead of the analysis.
//
// PLoT FORWARDS ISL'S BLOCK VERBATIM. It does not parse, rename or fill it: CEE is the validating boundary and
// strict-parses `DecisionFlipBlockV1` (@talchain/schemas 0.75.0) with its own pin. PLoT's only check is STRUCTURAL —
// an object whose `method` is the one ISL method this path knows. Anything else (an ISL error, a timeout, a
// malformed body) is a typed `decision_flip_unavailable` reason on a 200, never a 5xx: CEE answers the honest limit.
// =============================================================================

export const ISL_DECISION_FLIP_PATH = '/api/v1/robustness/decision-flip/v2';
export const DECISION_FLIP_METHOD = 'affine_crn_replicates_v1';
/** ISL's default K; the licence (median of K, range-bounded) is ISL's and the contract's, not PLoT's. */
export const DECISION_FLIP_DEFAULT_REPLICATES = 4;

export interface DecisionFlipBody {
  links: Array<{ from_id: string; to_id: string }>;
  replicates?: number;
}

/** Ajv fragment for runV3Schema.body.properties (additionalProperties: false at every level). */
export const DECISION_FLIP_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['links'],
  properties: {
    links: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from_id', 'to_id'],
        properties: {
          from_id: { type: 'string', minLength: 1 },
          to_id: { type: 'string', minLength: 1 },
        },
      },
    },
    replicates: { type: 'integer', minimum: 2, maximum: 8 },
  },
} as const;

/** The structural guard: an object carrying ISL's method. Never a parse — CEE parses. */
export function isDecisionFlipBlock(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
    && (x as { method?: unknown }).method === DECISION_FLIP_METHOD;
}

export function decisionFlipIslBody(islRequest: unknown, body: DecisionFlipBody) {
  return {
    request: islRequest,
    links: body.links,
    replicates: body.replicates ?? DECISION_FLIP_DEFAULT_REPLICATES,
  };
}

export type DecisionFlipUnavailableReason =
  | 'ISL_TIMEOUT' | 'ISL_NETWORK_ERROR' | 'ISL_REJECTED' | 'ISL_ERROR' | 'ISL_NOT_ENABLED'
  | 'DECISION_FLIP_MALFORMED';

const KNOWN_ISL_CODES: ReadonlySet<string> = new Set(['ISL_TIMEOUT', 'ISL_NETWORK_ERROR', 'ISL_REJECTED', 'ISL_ERROR', 'ISL_NOT_ENABLED']);

/** The /v2/run response for a decision-flip request: the block verbatim, or a typed reason and no block. */
export function decisionFlipResponse(
  result: { data?: unknown; error?: { code: string; retryable: boolean; status?: number } | null },
  requestId: string,
) {
  if (result.data !== undefined && result.data !== null && isDecisionFlipBlock(result.data)) {
    return { decision_flip: result.data, decision_flip_unavailable: null, meta: { request_id: requestId } };
  }
  const code = result.error?.code;
  const reason: DecisionFlipUnavailableReason = code && KNOWN_ISL_CODES.has(code)
    ? (code as DecisionFlipUnavailableReason)
    : 'DECISION_FLIP_MALFORMED';
  return {
    decision_flip: null,
    decision_flip_unavailable: {
      reason,
      status: result.error?.status ?? null,
      retryable: result.error?.retryable ?? false,
    },
    meta: { request_id: requestId },
  };
}
