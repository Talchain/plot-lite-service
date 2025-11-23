import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayloadV1,
} from '@olumi/assistants-sdk';

export type OrchestratorEnv = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type OrchestratorResult = {
  review: CeeDecisionReviewPayloadV1 | null;
  trace: { requestId?: string; degraded?: boolean; timestamp?: string } | null;
  error?: { code?: string; retryable: boolean; suggestedAction: 'retry' | 'fix_input' | 'fail'; traceId?: string };
};

/**
 * Calls Assistants CEE endpoints via SDK and collapses into the frozen v1 Decision Review payload.
 * Keep inputs minimal for now (safe brief); you can pass a real graph later if desired.
 */
export async function runDecisionReviewViaSdk(env: OrchestratorEnv, brief: string): Promise<OrchestratorResult> {
  const client = createCEEClient({
    apiKey: String(env.apiKey ?? ''),
    baseUrl: env.baseUrl,
    timeout: Number(env.timeoutMs ?? 10_000),
  });

  try {
    // 1) Draft a small graph from brief
    const draft = await client.draftGraph({ brief });

    // 2) Options from draft graph
    const options = await client.options({ graph: draft.graph, archetype: draft.archetype });

    // 3) Evidence suggestions (empty seed list is fine)
    const evidence = await client.evidenceHelper({ evidence: [] });

    // 4) Bias/structure checks
    const bias = await client.biasCheck({ graph: draft.graph, archetype: draft.archetype });

    // 5) Optional team perspectives (empty set for now)
    const team = await client.teamPerspectives({ perspectives: [] });

    const review = buildCeeDecisionReviewPayload({ draft, options, evidence, bias, team });

    return {
      review,
      trace: {
        requestId: (draft as any)?.trace?.request_id ?? (draft as any)?.trace?.requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    const code =
      err?.code ||
      err?.response?.data?.code ||
      'CEE_CLIENT_ERROR';
    const retryable = code === 'CEE_TIMEOUT' || code === 'CEE_UNAVAILABLE';
    return {
      review: null,
      trace: { degraded: true, timestamp: new Date().toISOString() },
      error: { code, retryable, suggestedAction: retryable ? 'retry' : 'fail', traceId: err?.traceId },
    };
  }
}
