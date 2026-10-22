'use strict';
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const { seedDemo } = require('./src/seed');

async function main() {
  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || '127.0.0.1'; // loopback by default; set HOST=0.0.0.0 for LAN access
  const db = openDb(process.env.DB_FILE || 'data/taxi.db');

  if (process.env.SEED_DEMO === 'true') {
    await seedDemo(db, {
      adminPassword: process.env.ADMIN_PASSWORD,
      dispatcherPassword: process.env.DISPATCHER_PASSWORD,
    });
  }

  const app = createApp(db, { secureCookie: process.env.COOKIE_SECURE === 'true' });
  const server = app.listen(port, host, () => console.log(`Taxi app listening on http://${host}:${port}`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  // Fail securely: refuse to start with missing/invalid configuration.
  console.error('Startup failed:', err.message);
  process.exit(1);
});
