const fs = require('fs'); const path = 'docs/plot-lite-engine';
const files = ['00-overview.md','10-architecture.md','20-roadmap.md','30-workplan.md','40-risks.md','50-test-plan.md'];
const out = ['# PLoT Lite Engine — Plan Index','','## Sections',''];
for (const f of files) out.push(`- [${f.replace(/^\d+-|\.md$/g,'').replace(/-/g,' ')}](${path}/${f})`);
fs.writeFileSync(`${path}/README.md`, out.join('\n') + '\n');
console.log('Wrote docs/plot-lite-engine/README.md');
