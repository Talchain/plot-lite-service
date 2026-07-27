/**
 * Regenerate the committed PLoT → ISL egress fixtures.
 *
 * Contract step-2 slice 2. These fixtures are the INPUT to the pinned-model
 * replay driver (`replay-through-pinned-model.py`), which is the only step that
 * needs a Python runtime. The standing vitest gate re-derives the same bytes
 * from the same producers and fails if they differ from what is committed here —
 * so a producer change makes the replay transcript provably stale rather than
 * silently wrong.
 *
 *   npx tsx tools/isl-contract/capture-egress.ts
 *
 * Then re-run the replay driver (see tests/fixtures/isl-pinned/PIN.json).
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCERS,
  installEgressCapture,
  uninstallEgressCapture,
  canonicalEgressFixture,
} from '../../tests/helpers/isl-egress-producers.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../tests/fixtures/isl-pinned/egress');

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.json')) rmSync(resolve(outDir, f));
  }

  for (const producer of PRODUCERS) {
    installEgressCapture();
    const captures = await producer.run();
    uninstallEgressCapture();
    if (captures.length !== 1) {
      throw new Error(
        `producer ${producer.name} produced ${captures.length} bodies, expected exactly 1`,
      );
    }
    const path = resolve(outDir, `${producer.name}.json`);
    writeFileSync(path, canonicalEgressFixture(producer, captures[0]!), 'utf8');
    console.log(`wrote ${path}`);
  }
  console.log(`\n${PRODUCERS.length} egress fixtures written. Now re-run:`);
  console.log('  tools/isl-contract/replay-through-pinned-model.py --isl-repo <clone at the PIN sha>');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
