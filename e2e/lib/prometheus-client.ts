export class PrometheusClient {
  constructor(private baseUrl = 'http://localhost:9090') {}
  async query(q: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/query?query=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('Prom query failed');
    const j = await res.json();
    return j.data;
  }
  async val(q: string): Promise<number|null> {
    const d = await this.query(q);
    if (!d.result?.length) return null;
    return parseFloat(d.result[0].value[1]);
  }
}
