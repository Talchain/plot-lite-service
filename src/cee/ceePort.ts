import type { CeeDecisionReviewPayloadV1, CeeReviewResult, CeeTrace, CeeError } from './types.js';

export interface CeeClient {
  reviewDecision(payload: CeeDecisionReviewPayloadV1, opts?: { requestId?: string }): Promise<CeeReviewResult>;
}

export function buildCeeDecisionReviewPayload(ctx: Omit<CeeDecisionReviewPayloadV1, 'schema'>): CeeDecisionReviewPayloadV1 {
  return { ...ctx, schema: 'cee.decision-review.v1' };
}

// Shim client: returns a degraded result signalling SDK unavailability.
// When the real SDK is available, replace this entire file with:
//   import { createCEEClient, buildCeeDecisionReviewPayload } from '@olumi/assistants-sdk'
export function createCEEClient(_: { baseUrl: string; apiKey: string; timeoutMs?: number }): CeeClient {
  return {
    async reviewDecision(_payload, opts): Promise<CeeReviewResult> {
      const trace: CeeTrace = {
        requestId: String(opts?.requestId || ''),
        degraded: true,
        timestamp: new Date().toISOString(),
      };
      const error: CeeError = { code: 'CEE_SDK_UNAVAILABLE', suggestedAction: 'retry' };
      return { review: null, trace, error };
    },
  };
}
