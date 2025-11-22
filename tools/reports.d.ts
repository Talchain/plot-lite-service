// Type declarations for tests.json v1.3
export interface TestCase {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface TestsSummary {
  total: number;
  ok: number;
  failed: number;
  timestamp: string;
  durationMs?: number;
}

export interface TestsReportV13 {
  summary: TestsSummary;
  cases: TestCase[];
}
