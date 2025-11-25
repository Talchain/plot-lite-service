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

export type EvidenceHelperItem = {
  id: string;
  type: 'experiment' | 'user_research' | 'market_data' | 'expert_opinion' | 'other';
  source?: string;
  content?: string;
};

export type BriefContext = {
  nodes?: number;
  edges?: number;
};

export function buildCeeBrief(shortLabel: string, context?: BriefContext): string {
  const prefix = 'Decision review context: ';
  const label = (shortLabel ?? '').trim();
  let brief = prefix + (label || 'scenario');

  // Add structural hints (no user content exposed)
  if (context && (context.nodes || context.edges)) {
    brief += ` (${context.nodes ?? 0} nodes, ${context.edges ?? 0} edges)`;
  }

  if (brief.length < 30) {
    brief += ' Please elaborate.';
  }

  return brief;
}

/**
 * Calls Assistants CEE endpoints via SDK and collapses into the frozen v1 Decision Review payload.
 * Keep inputs minimal for now (safe brief); you can pass a real graph later if desired.
 */
export async function runDecisionReviewViaSdk(
  env: OrchestratorEnv,
  brief: string,
  evidenceItems?: EvidenceHelperItem[],
  briefContext?: BriefContext,
): Promise<OrchestratorResult> {
  const client = createCEEClient({
    apiKey: String(env.apiKey ?? ''),
    baseUrl: env.baseUrl,
    timeout: Number(env.timeoutMs ?? 10_000),
  });

  try {
    // 1) Draft a small graph from brief (non-streaming for deterministic behaviour)
    const draftBrief = buildCeeBrief(brief, briefContext);
    const draft = await client.draftGraph({ brief: draftBrief, config: { streaming: false } });

    // 2) Options from draft graph – strict payload: { graph, archetype }
    const archetype = (draft as any)?.archetype ?? null;
    const options = await client.options({ graph: draft.graph, archetype });

    // 3) Evidence helper – only call when we have at least one evidence item
    let evidence: any | undefined;
    if (Array.isArray(evidenceItems) && evidenceItems.length > 0) {
      evidence = await client.evidenceHelper({ evidence: evidenceItems });
    }

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
