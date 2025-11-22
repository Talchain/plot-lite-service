export function renderMarkdown(results: any[]): string {
  let md = '# E2E Test Report\n\n';
  const passed = results.filter(r => r.sum?.failed === 0).length;
  md += `**Summary**: ${passed}/${results.length} scenarios passed\n\n`;
  for (const r of results) {
    const icon = r.sum?.failed === 0 ? '✅' : '❌';
    md += `${icon} **${r.name}** (${r.dur?.toFixed(1)}ms): ${r.sum?.passed}/${r.sum?.total}\n`;
  }
  return md;
}
