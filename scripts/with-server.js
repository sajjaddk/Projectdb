'use strict';
// Usage: node scripts/with-server.js <command...>
// Starts the app (in-memory DB, fake demo credentials from .env.test), waits until it is healthy,
// runs the command, then stops the app and exits with the command's exit code.
// PORT can be overridden so several suites can run in parallel (e.g. in Jenkins).
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const command = process.argv.slice(2).join(' ');
if (!command) {
  console.error('Usage: node scripts/with-server.js <command>');
  process.exit(2);
}

fs.mkdirSync('reports/k6', { recursive: true }); // k6 does not create output folders itself
process.loadEnvFile('.env.test'); // does not override variables that are already set
const port = process.env.PORT || '4000';
const env = { ...process.env, PORT: port };

const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env });
let finished = false;
server.on('exit', (code) => {
  if (!finished) {
    console.error(`App exited early with code ${code}`);
    process.exit(1);
  }
});

async function waitForHealth() {
  const url = `http://127.0.0.1:${port}/api/health`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App did not become healthy at ${url}`);
}

(async () => {
  let code = 1;
  try {
    await waitForHealth();
    code = await new Promise((resolve) => {
      const child = spawn(command, { shell: true, stdio: 'inherit', env });
      child.on('exit', (c) => resolve(c ?? 1));
    });
  } catch (err) {
    console.error(err.message);
  } finally {
    finished = true;
    server.kill();
  }
  process.exit(code);
})();
