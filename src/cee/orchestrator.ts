import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  buildCeeErrorView,
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
    // 1) Draft a small graph from brief (non-streaming for deterministic behaviour)
    const draft = await client.draftGraph({ brief, config: { streaming: false } });

    // 2) Options from draft graph – strict payload: { graph, archetype }
    const archetype = (draft as any)?.archetype ?? null;
    const options = await client.options({ graph: draft.graph, archetype });

    // 3) Evidence suggestions (empty seed list is fine)
    const evidence = await client.evidenceHelper({ evidence: [] });

    // 4) Bias/structure checks – strict payload: { graph, archetype }
    const bias = await client.biasCheck({ graph: draft.graph, archetype });

    const review = buildCeeDecisionReviewPayload({ draft, options, evidence, bias });

    return {
      review,
      trace: {
        requestId: (draft as any)?.trace?.request_id ?? (draft as any)?.trace?.requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    const view = buildCeeErrorView(err);
    return {
      review: null,
      trace: { degraded: true, timestamp: new Date().toISOString() },
      error: {
        code: view.code,
        retryable: view.retryable,
        suggestedAction: view.suggestedAction,
        traceId: view.traceId,
      },
    };
  }
}
