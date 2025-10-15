#!/usr/bin/env node
/**
 * evidence-pack-generate.mjs - Generate Evidence Pack for staging deploy
 * Creates canonical evidence/ directory with pack-meta.json, slos.live.json, report_v1.seed*.json
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const EVIDENCE_DIR = join(process.cwd(), 'artifact', 'pack', 'evidence');

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const commitShort = commit.slice(0, 8);
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { commit, commitShort, branch };
  } catch {
    return { commit: process.env.RENDER_GIT_COMMIT || 'dev', commitShort: 'dev', branch: 'main' };
  }
}

async function main() {
  console.log('📦 Generating Evidence Pack...');
  
  // Create evidence directory
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  
  const git = getGitInfo();
  const timestamp = new Date().toISOString();
  
  // 1. pack-meta.json
  const packMeta = {
    schema: 'pack-meta.v1',
    commit: git.commit,
    commit_short: git.commitShort,
    branch: git.branch,
    build_timestamp: timestamp,
    flags: {
      SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE || '0',
      AUTH_ENABLED: process.env.AUTH_ENABLED || '0',
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== '0' ? '1' : '0',
      SCM_LITE_K: process.env.SCM_LITE_K || '500',
      SCM_LITE_BELIEF_DEFAULT: process.env.SCM_LITE_BELIEF_DEFAULT || '0.5',
    },
  };
  
  const packMetaPath = join(EVIDENCE_DIR, 'pack-meta.json');
  writeFileSync(packMetaPath, JSON.stringify(packMeta, null, 2), 'utf8');
  console.log(`✅ Created: ${packMetaPath}`);
  
  // 2. slos.live.json (placeholder - will be updated by load probe)
  const slos = {
    schema: 'slos.v1',
    source: 'evidence-pack-generate',
    timestamp,
    engine_get_p95_ms: 0, // Will be updated by actual runs
    note: 'Initial placeholder - run load probe to populate real metrics',
  };
  
  const slosPath = join(EVIDENCE_DIR, 'slos.live.json');
  writeFileSync(slosPath, JSON.stringify(slos, null, 2), 'utf8');
  console.log(`✅ Created: ${slosPath}`);
  
  // 3. report_v1.seed4242.json (golden fixture response)
  // Check if we can generate a real response by running the server
  const fixtureFile = join(process.cwd(), 'fixtures', 'run-graph.json');
  
  if (existsSync(fixtureFile)) {
    try {
      // Try to generate a real response (requires server to be running or build to exist)
      console.log('📝 Golden fixture found, creating placeholder report...');
      
      const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
      
      // Placeholder report (matches run.v1 schema)
      const report = {
        schema: 'run.v1',
        results: {
          conservative: { outcome: 0, percentile: 10 },
          most_likely: { outcome: 0, percentile: 50 },
          optimistic: { outcome: 0, percentile: 90 },
        },
        confidence: {
          level: 'MEDIUM',
          factors: {
            mask_diversity: 0.5,
            path_stability: 0.7,
            linearity_distance: 0.3,
          },
        },
        meta: {
          seed: fixture.seed || 4242,
        },
        model_card: {
          response_hash: 'placeholder',
          bma_hash: 'placeholder',
          compute_budget: {
            k_samples: 500,
          },
        },
        note: 'Placeholder - run actual /v1/run request to generate real report',
      };
      
      const reportPath = join(EVIDENCE_DIR, `report_v1.seed${fixture.seed || 4242}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`✅ Created: ${reportPath}`);
    } catch (e) {
      console.warn(`⚠️  Could not generate report: ${e.message}`);
    }
  } else {
    console.warn('⚠️  Golden fixture not found, skipping report generation');
  }
  
  console.log('');
  console.log('✅ Evidence Pack generated successfully!');
  console.log(`📁 Location: ${EVIDENCE_DIR}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Deploy to staging');
  console.log('  2. Run smoke test to populate real metrics');
  console.log('  3. Run load probe to update slos.live.json');
}

main().catch((e) => {
  console.error('❌ Evidence Pack generation failed:', e.message);
  process.exit(1);
});
