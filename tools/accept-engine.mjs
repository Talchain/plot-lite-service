#!/usr/bin/env node
import http from 'http';

const PORT = process.env.PORT || 4311;
const url = `http://127.0.0.1:${PORT}/health`;

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      // Critical: Check HTTP status code first
      if (res.statusCode !== 200) {
        console.error('=== ENGINE ACCEPTANCE ===');
        console.error(`ENGINE_FAIL: HTTP ${res.statusCode}`);
        console.error(`ENGINE_HEALTH: ${data}`);
        process.exit(1);
      }
      
      const health = JSON.parse(data);
      
      // Critical: Check health status field
      if (health.status !== 'ok') {
        console.error('=== ENGINE ACCEPTANCE ===');
        console.error(`ENGINE_FAIL: status=${health.status}`);
        console.error(`ENGINE_HEALTH: ${JSON.stringify(health, null, 2)}`);
        process.exit(1);
      }
      
      const testRoutes = health.test_routes_enabled ? 'ON' : 'OFF';
      const corsOk = process.env.CORS_ORIGINS ? 'OK' : 'MISSING';
      
      console.log('=== ENGINE ACCEPTANCE ===');
      console.log(`ENGINE_OK: port=${PORT}, cors=${corsOk}, test_routes=${testRoutes}`);
      console.log(`ENGINE_HEALTH: ${data.trim()}`);
      process.exit(0);
    } catch (err) {
      console.error('=== ENGINE ACCEPTANCE ===');
      console.error('ENGINE_FAIL: Failed to parse health response:', err.message);
      console.error('Raw response:', data);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error(`Failed to connect to engine on port ${PORT}:`, err.message);
  console.error('=== ENGINE ACCEPTANCE ===');
  console.error('ENGINE_FAIL: connection refused');
  console.error('ENGINE_HEALTH: NOT_RUNNING');
  process.exit(1);
});
