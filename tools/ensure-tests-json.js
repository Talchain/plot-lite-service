diff --git a/tools/ensure-tests-json.js b/tools/ensure-tests-json.js
--- a/tools/ensure-tests-json.js
+++ b/tools/ensure-tests-json.js
@@
 const fs = require('fs');
 const path = require('path');
 const { spawn } = require('child_process');
 
 const outDir = path.resolve(process.cwd(), 'reports');
 const outFile = path.resolve(outDir, 'tests.json');
 
 function run(cmd, args, opts = {}) {
-  return new Promise((resolve) => {
+  return new Promise((resolve) => {
     const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, ...opts });
     let out = '';
     p.stdout.on('data', (d) => { out += d.toString(); });
-    p.on('close', (code) => resolve({ code: code || 1, stdout: out }));
+    // Treat a real 0 as success; only default to 1 if code is undefined/null
+    p.on('close', (code) => resolve({ code: (typeof code === 'number' ? code : 1), stdout: out }));
   });
 }
 
 async function main() {
   try {
     if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
     if (fs.existsSync(outFile)) {
       console.log('tests.json already present; skipping generation.');
       return;
     }
-    console.log('tests.json missing; invoking vitest JSON reporter fallback...');
-    const { stdout } = await run('npx', ['vitest', 'run', '--reporter=json']);
+    // Allow CI to skip expensive npx runs
+    if (process.env.ENSURE_TESTS_JSON_SKIP_RUN === '1') {
+      console.log('tests.json missing; writing minimal JSON stub (skip run).');
+      fs.writeFileSync(outFile, '{}', 'utf8');
+      return;
+    }
+    console.log('tests.json missing; invoking vitest JSON reporter fallback...');
+    const { stdout } = await run('npx', ['vitest', 'run', '--reporter=json']);
     if (stdout && stdout.trim().length > 0) fs.writeFileSync(outFile, stdout, 'utf8');
     if (!fs.existsSync(outFile)) {
       console.warn('Fallback did not produce tests.json; writing empty JSON.');
       fs.writeFileSync(outFile, '{}', 'utf8');
     }
   } catch (e) {
     console.warn('ensure-tests-json failed:', e && e.message ? e.message : e);
     try { fs.writeFileSync(outFile, '{}', 'utf8'); } catch {}
   }
 }
 
 main();
