import type {
  ClientOptions,
  RunRequest, RunResponse,
  CompareRequest, CompareResponse,
  InspectRequest, InspectResponse,
  InterveneRequest, InterveneResponse,
  OptimiseRequest, OptimiseResponse,
  RunBundleRequest, RunBundleResponse,
  RunTimeslicesRequest, RunTimeslicesResponse,
  LimitsResponse,
  HealthResponse
} from './types.js';
import { validatePriors, validateEvidence, validateTimeslices } from './validators.js';

export class PlotLiteClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(baseUrl: string, options: ClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout || 30000;
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(error.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${this.timeout}ms`);
        }
        throw error;
      }
      throw new Error('Unknown error occurred');
    }
  }

  private getNodeIds(graph: { nodes: Array<{ id: string }> }): Set<string> {
    return new Set(graph.nodes.map(n => n.id));
  }

  async run(request: RunRequest): Promise<RunResponse> {
    // Client-side validation
    if (request.priors) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validatePriors(request.priors, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    if (request.evidence) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validateEvidence(request.evidence, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    return this.request<RunResponse>('POST', '/v1/run', request);
  }

  async compare(request: CompareRequest): Promise<CompareResponse> {
    return this.request<CompareResponse>('POST', '/v1/compare', request);
  }

  async inspect(request: InspectRequest): Promise<InspectResponse> {
    return this.request<InspectResponse>('POST', '/v1/inspect', request);
  }

  async intervene(request: InterveneRequest): Promise<InterveneResponse> {
    return this.request<InterveneResponse>('POST', '/v1/intervene', request);
  }

  async optimise(request: OptimiseRequest): Promise<OptimiseResponse> {
    // Client-side validation
    if (request.priors) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validatePriors(request.priors, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    if (request.evidence) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validateEvidence(request.evidence, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    return this.request<OptimiseResponse>('POST', '/v1/optimise', request);
  }

  async runBundle(request: RunBundleRequest): Promise<RunBundleResponse> {
    // Client-side validation
    if (request.priors) {
      const nodeIds = this.getNodeIds(request.base_graph);
      const validation = validatePriors(request.priors, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    if (request.evidence) {
      const nodeIds = this.getNodeIds(request.base_graph);
      const validation = validateEvidence(request.evidence, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    return this.request<RunBundleResponse>('POST', '/v1/run_bundle', request);
  }

  async runTimeslices(request: RunTimeslicesRequest): Promise<RunTimeslicesResponse> {
    // Client-side validation
    const timeslicesValidation = validateTimeslices(request.timeslices);
    if (!timeslicesValidation.valid) {
      throw new Error(`Validation failed: ${timeslicesValidation.errors[0].message} (${timeslicesValidation.errors[0].field})`);
    }

    if (request.priors) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validatePriors(request.priors, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    if (request.evidence) {
      const nodeIds = this.getNodeIds(request.graph);
      const validation = validateEvidence(request.evidence, nodeIds);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors[0].message} (${validation.errors[0].field})`);
      }
    }

    return this.request<RunTimeslicesResponse>('POST', '/v1/run_timeslices', request);
  }

  async getLimits(): Promise<LimitsResponse> {
    return this.request<LimitsResponse>('GET', '/v1/limits');
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }
}
